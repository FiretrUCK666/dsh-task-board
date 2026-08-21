/**
 * Controller tests: orchestration — persistence, view state, navigation
 * awareness, and the full run loop (running → started(sessionId) → settled).
 */
import { describe, expect, it } from 'vitest'
import { BoardController, type ControllerDeps } from '../src/core/controller.ts'
import { ExecutionService, type ExecutionEvent } from '../src/core/execution.ts'
import { InMemoryTaskStore } from '../src/core/store.ts'
import { executionUnviewed, taskUnviewed } from '../src/core/session-display.ts'
import { sessionCommentsOf } from '../src/client/board/comment-thread.ts'
import type { CruiseWindow } from '../src/core/cruise.ts'
import { createTask, ruleReadiness, withSchedule, type TaskRecord } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000
let nextId = 0
const uuid = (): string => { nextId += 1; return `id-${nextId}` }

/** Flush pending microtasks (async controller paths). */
const flush = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

/** Controllable sessions face (selection + open + running state). */
class FakeSessions {
  current: string | undefined = undefined
  openCalls: string[] = []
  /** Known session ids; undefined = every id exists (legacy fake behavior). */
  knownIds: Set<string> | undefined = undefined
  /** Host list running flags per session id (absent id = unknown to the list). */
  runningById: Record<string, boolean> = {}
  /** Host-list pending-interaction signals per session (native amber dot). */
  waitingById: Record<string, 'approval' | 'plan-review' | 'question'> = {}
  /** Host-list workspace facts per session. */
  infoById: Record<string, { cwd?: string; agentPreset?: string }> = {}
  private listeners = new Set<() => void>()
  list = {
    getSnapshot: (): {
      current: string | undefined
      byId: Record<string, { running: boolean; pendingInteraction?: 'approval' | 'plan-review' | 'question'; cwd?: string; agentPreset?: string }>
    } => ({
      current: this.current,
      byId: Object.fromEntries(
        Object.entries(this.runningById).map(([id, running]) => [id, {
          running,
          ...this.waitingById[id] !== undefined ? { pendingInteraction: this.waitingById[id] } : {},
          ...this.infoById[id] !== undefined ? this.infoById[id] : {},
        }]),
      ),
    }),
    subscribe: (fn: () => void): (() => void) => {
      this.listeners.add(fn)
      return () => { this.listeners.delete(fn) }
    },
  }
  exists(id: string): boolean {
    return this.knownIds === undefined || this.knownIds.has(id)
  }
  open(id: string): void {
    this.openCalls.push(id)
    this.setCurrent(id)
  }
  setCurrent(id: string | undefined): void {
    this.current = id
    for (const fn of [...this.listeners]) fn()
  }
  /** Set the host-list running flag of a session and notify (list change). */
  setRunning(id: string, running: boolean): void {
    this.runningById[id] = running
    for (const fn of [...this.listeners]) fn()
  }
  /** Set a session's pending-interaction signal and notify (list change). */
  setWaiting(id: string, waiting: 'approval' | 'plan-review' | 'question' | undefined): void {
    this.runningById[id] ??= false
    if (waiting === undefined) delete this.waitingById[id]
    else this.waitingById[id] = waiting
    for (const fn of [...this.listeners]) fn()
  }
  /** Set a session's workspace facts and notify (list change). */
  setInfo(id: string, info: { cwd?: string; agentPreset?: string }): void {
    this.runningById[id] ??= false
    this.infoById[id] = info
    for (const fn of [...this.listeners]) fn()
  }
}

/** Controllable ExecutionService stub: captures run calls, fires events on demand. */
class StubExec {
  runCalls: Array<{ task: TaskRecord; taskId: string; executionId: string; options?: { prompt?: string; sessionId?: string; fresh?: boolean; renameTo?: string }; fire: (event: ExecutionEvent) => void }> = []
  commentCalls: Array<{ taskId: string; executionId: string; sessionId: string; text: string; fire: (event: ExecutionEvent) => void }> = []
  reconcileResult: ExecutionEvent | undefined = undefined
  async run(
    task: TaskRecord,
    execution: { id: string },
    onEvent: (event: ExecutionEvent) => void,
    options?: { prompt?: string; sessionId?: string; fresh?: boolean; renameTo?: string },
  ): Promise<void> {
    this.runCalls.push({ task, taskId: task.id, executionId: execution.id, options, fire: onEvent })
  }
  async commentRun(task: TaskRecord, execution: { id: string }, sessionId: string, text: string, onEvent: (event: ExecutionEvent) => void): Promise<void> {
    this.commentCalls.push({ taskId: task.id, executionId: execution.id, sessionId, text, fire: onEvent })
  }
  reconcile(): ExecutionEvent | undefined {
    return this.reconcileResult
  }
}

function makeController(stub = new StubExec(), extra: Partial<ControllerDeps> = {}) {
  const sessions = new FakeSessions()
  const store = new InMemoryTaskStore()
  const deps: ControllerDeps = {
    store,
    exec: stub as unknown as ExecutionService,
    sessions,
    now: () => NOW,
    uuid,
    ...extra,
  }
  const controller = new BoardController(deps)
  controller.start()
  return { controller, sessions, store, stub }
}

function seedTask(store: InMemoryTaskStore, overrides: Partial<Parameters<typeof createTask>[0] & { id: string }> = {}) {
  const task = createTask(
    { title: '任务A', description: '描述', prompt: 'prompt A', ...overrides },
    NOW,
    overrides.id ?? 'task-a',
  )
  store.save([task])
  return task
}

describe('BoardController lifecycle', () => {
  it('loads the persisted ledger on start', () => {
    const { store } = makeController()
    seedTask(store)
    const reloaded = new BoardController({
      store, exec: new StubExec() as unknown as ExecutionService,
      sessions: new FakeSessions(), now: () => NOW, uuid,
    })
    reloaded.start()
    expect(reloaded.getSnapshot().tasks.map(task => task.id)).toEqual(['task-a'])
  })

  it('dispose unsubscribes (no more notifications)', () => {
    const { controller, sessions } = makeController()
    let count = 0
    controller.subscribe(() => { count += 1 })
    controller.dispose()
    sessions.setCurrent('s-1')
    expect(count).toBe(0)
  })
})

describe('task mutations', () => {
  it('creates, persists, and rejects blank titles', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: ' 新任务 ', description: '', prompt: 'run' })
    expect(task).toBeDefined()
    expect(controller.getSnapshot().tasks).toHaveLength(1)
    expect(store.load()[0].title).toBe('新任务')
    expect(controller.createTask({ title: '   ', description: '', prompt: 'run' })).toBeUndefined()
  })

  it('deletes and clears the selection when the selected task is removed', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.openTask(task.id)
    controller.deleteTask(task.id)
    expect(controller.getSnapshot().tasks).toHaveLength(0)
    expect(controller.getSnapshot().selectedTaskId).toBeUndefined()
    expect(store.load()).toEqual([])
  })

  it('updates and moves tasks with persistence', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.updateTask(task.id, { title: 'y' })
    controller.moveTask(task.id, 'backlog')
    const persisted = store.load()[0]
    expect(persisted.title).toBe('y')
    expect(persisted.status).toBe('backlog')
  })

  it('disarms an armed schedule rule when the task is moved to done', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setSchedule(task.id, { enabled: true, cron: '0 9 * * *' })
    expect(store.load()[0].schedule?.enabled).toBe(true)
    controller.moveTask(task.id, 'done')
    const completed = store.load()[0]
    expect(completed.status).toBe('done')
    expect(completed.schedule?.enabled).toBe(false)
    expect(completed.schedule?.nextRunAt).toBeUndefined()
    // The rule's configuration survives re-arming.
    expect(completed.schedule?.cron).toBe('0 9 * * *')
  })

  it('a done-disarmed rule stays off when the task moves back to a live column', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setSchedule(task.id, { enabled: true, cron: '0 9 * * *' })
    controller.moveTask(task.id, 'done')
    expect(store.load()[0].schedule?.enabled).toBe(false)
    // Moving out of done is a manual re-open, never an auto resume.
    controller.moveTask(task.id, 'todo')
    expect(store.load()[0].schedule?.enabled).toBe(false)
    expect(store.load()[0].status).toBe('todo')
  })

  it('moving to backlog/review keeps an armed rule untouched (paused, not disarmed)', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setSchedule(task.id, { enabled: true, cron: '0 9 * * *' })
    controller.moveTask(task.id, 'backlog')
    expect(store.load()[0].schedule?.enabled).toBe(true)
  })

  it('reads a session pending-interaction signal live from the session list', () => {
    const { controller, sessions } = makeController()
    expect(controller.pendingInteractionOf(undefined)).toBeUndefined()
    expect(controller.pendingInteractionOf('s-1')).toBeUndefined()
    sessions.setWaiting('s-1', 'plan-review')
    expect(controller.pendingInteractionOf('s-1')).toBe('plan-review')
    sessions.setWaiting('s-1', undefined)
    expect(controller.pendingInteractionOf('s-1')).toBeUndefined()
  })

  it('reports the session workspace facts (cwd / agent preset)', () => {
    const { controller, sessions } = makeController()
    expect(controller.sessionInfo(undefined)).toBeUndefined()
    expect(controller.sessionInfo('s-1')).toBeUndefined()
    sessions.setInfo('s-1', { cwd: 'C:\\work\\proj', agentPreset: 'butler' })
    expect(controller.sessionInfo('s-1')).toEqual({ cwd: 'C:\\work\\proj', agentPreset: 'butler' })
  })

  it('notifies subscribers when the session list changes (wait states surface live)', () => {
    const { controller, sessions } = makeController()
    controller.openBoard()
    let notified = 0
    controller.subscribe(() => { notified += 1 })
    sessions.setWaiting('s-1', 'approval')
    expect(notified).toBeGreaterThan(0)
  })

  it('creates into the chosen landing column, ranking newest at its top', () => {
    const { controller, store } = makeController()
    const todo = controller.createTask({ title: 'a', description: '', prompt: 'run' })!
    const backlog = controller.createTask({ title: 'b', description: '', prompt: 'run', status: 'backlog' })!
    expect(todo.status).toBe('todo')
    expect(backlog.status).toBe('backlog')
    // Each fresh card is the newest of ITS column (order 0) — different
    // columns sort independently, so their new cards do not collide.
    expect(store.load().map(row => [row.id, row.status, row.order])).toEqual([
      [todo.id, 'todo', 0],
      [backlog.id, 'backlog', 0],
    ])
  })

  it('reorders cards within a column (same-column move with beforeId)', () => {
    const { controller, store } = makeController()
    const a = controller.createTask({ title: 'a', description: '', prompt: 'run' })!
    const b = controller.createTask({ title: 'b', description: '', prompt: 'run' })!
    const c = controller.createTask({ title: 'c', description: '', prompt: 'run' })!
    const keyed = (): Record<string, number> =>
      Object.fromEntries(store.load().map(task => [task.id, task.order]))
    // Move the last card before the first: c gets key 0, a and b shift.
    controller.moveTask(c.id, 'todo', a.id)
    expect(keyed()).toEqual({ [c.id]: 0, [a.id]: 1, [b.id]: 2 })
    // Moving a card onto itself keeps its position.
    controller.moveTask(c.id, 'todo', c.id)
    expect(keyed()).toEqual({ [c.id]: 0, [a.id]: 1, [b.id]: 2 })
    // Moving to another column does not disturb the source column's keys.
    controller.moveTask(b.id, 'backlog')
    expect(keyed()).toEqual({ [c.id]: 0, [a.id]: 1, [b.id]: 0 })
  })

  it('updates content and run configuration, clearing fields with undefined', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({
      title: 'x', description: '', prompt: 'run',
      workspaceId: 'w-1', agentPreset: 'preset-a', permission: 'full',
    })!
    expect(controller.updateTask(task.id, {
      title: ' 新标题 ',
      description: ' 新描述 ',
      prompt: ' 新 prompt ',
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
      workspaceId: undefined,
      agentPreset: undefined,
      permission: undefined,
    })).toBe(true)
    const persisted = store.load()[0]
    expect(persisted.title).toBe('新标题')
    expect(persisted.description).toBe('新描述')
    expect(persisted.prompt).toBe('新 prompt')
    expect(persisted.provider).toBe('deepseek')
    expect(persisted.model).toBe('deepseek-chat')
    expect(persisted.reasoningEffort).toBe('high')
    expect(persisted.workspaceId).toBeUndefined()
    expect(persisted.agentPreset).toBeUndefined()
    expect(persisted.permission).toBeUndefined()
  })

  it('rejects blank titles and unknown tasks without touching state', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    expect(controller.updateTask(task.id, { title: '   ' })).toBe(false)
    expect(controller.updateTask('missing', { title: 'y' })).toBe(false)
    expect(store.load()[0].title).toBe('x')
  })

  it('bumps updatedAt on every applied update', () => {
    let clock = NOW
    const sessions = new FakeSessions()
    const store = new InMemoryTaskStore()
    const controller = new BoardController({
      store, exec: new StubExec() as unknown as ExecutionService,
      sessions, now: () => clock, uuid,
    })
    controller.start()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    clock = NOW + 1000
    controller.updateTask(task.id, { description: 'd' })
    expect(store.load()[0].updatedAt).toBe(NOW + 1000)
  })

  it('runs with the latest edited content on the next execution', async () => {
    const stub = new StubExec()
    const { controller } = makeController(stub)
    const task = controller.createTask({ title: '旧标题', description: '', prompt: '旧 prompt' })!
    controller.updateTask(task.id, { title: '新标题', prompt: '新 prompt' })
    await controller.runTask(task.id)
    expect(stub.runCalls).toHaveLength(1)
    expect(stub.runCalls[0].task.title).toBe('新标题')
    expect(stub.runCalls[0].task.prompt).toBe('新 prompt')
  })
})

describe('view state', () => {
  it('toggles the board and reflects it in the snapshot', () => {
    const { controller } = makeController()
    expect(controller.getSnapshot().boardOpen).toBe(false)
    controller.openBoard()
    expect(controller.getSnapshot().boardOpen).toBe(true)
    controller.openBoard() // idempotent
    expect(controller.getSnapshot().boardOpen).toBe(true)
    controller.closeBoard()
    expect(controller.getSnapshot().boardOpen).toBe(false)
    controller.toggleBoard()
    expect(controller.getSnapshot().boardOpen).toBe(true)
  })

  it('closes the board when the user navigates to a session', () => {
    const { controller, sessions } = makeController()
    sessions.setCurrent('s-1')
    controller.openBoard()
    expect(controller.getSnapshot().boardOpen).toBe(true)
    sessions.setCurrent('s-2')
    expect(controller.getSnapshot().boardOpen).toBe(false)
  })

  it('closes the board when a new session is started (selection cleared)', () => {
    const { controller, sessions } = makeController()
    sessions.setCurrent('s-1')
    controller.openBoard()
    sessions.setCurrent(undefined)
    expect(controller.getSnapshot().boardOpen).toBe(false)
  })

  it('stays open on unrelated session-list changes (status updates of the same selection)', () => {
    const { controller, sessions } = makeController()
    sessions.setCurrent('s-1')
    controller.openBoard()
    // A notification with an unchanged selection must not close the board.
    for (const fn of [...(sessions as unknown as { listeners: Set<() => void> }).listeners]) fn()
    expect(controller.getSnapshot().boardOpen).toBe(true)
  })

  it('openTask/closeTask manage the selection', () => {
    const { controller } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.openTask(task.id)
    expect(controller.getSnapshot().selectedTaskId).toBe(task.id)
    controller.closeTask()
    expect(controller.getSnapshot().selectedTaskId).toBeUndefined()
  })

  it('openTask records the viewed baseline (clears the card unread)', async () => {
    let clock = NOW
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub, { now: () => clock })
    const task = controller.createTask({ title: 'x', description: '', prompt: 'p' })!
    expect(task.viewedAt).toBe(NOW) // created viewed

    // A run settles after creation → the card now has unread content.
    clock = NOW + 1_000
    await controller.runTask(task.id)
    clock = NOW + 1_500
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: exec.runCalls[0].executionId, outcome: 'succeeded' })
    expect(taskUnviewed(controller.getSnapshot().tasks[0])).toBe(true)

    // Opening the detail marks it viewed again and persists.
    clock = NOW + 2_000
    controller.openTask(task.id)
    expect(controller.getSnapshot().tasks[0].viewedAt).toBe(NOW + 2_000)
    expect(store.load()[0].viewedAt).toBe(NOW + 2_000)
    expect(taskUnviewed(controller.getSnapshot().tasks[0])).toBe(false)
  })

  it('markExecutionViewed clears a row unread and persists', async () => {
    let clock = NOW
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub, { now: () => clock })
    const task = controller.createTask({ title: 'x', description: '', prompt: 'p' })!
    clock = NOW + 1_000
    await controller.runTask(task.id)
    clock = NOW + 1_500
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: exec.runCalls[0].executionId, outcome: 'succeeded' })
    const executionId = exec.runCalls[0].executionId
    const record = controller.getSnapshot().tasks[0].executions.find(round => round.id === executionId)!
    expect(executionUnviewed(controller.getSnapshot().tasks[0], record)).toBe(true)

    // Opening the review page clears the row dot and persists.
    clock = NOW + 2_000
    controller.markExecutionViewed(task.id, executionId)
    const viewed = controller.getSnapshot().tasks[0].executions.find(round => round.id === executionId)!
    expect(viewed.viewedAt).toBe(NOW + 2_000)
    expect(store.load()[0].executions.find(round => round.id === executionId)!.viewedAt).toBe(NOW + 2_000)
    expect(executionUnviewed(controller.getSnapshot().tasks[0], viewed)).toBe(false)
    // ONE baseline: the review-page open ALSO clears the card-level ring
    // (task.viewedAt moves with it) — the "待审核打开复盘后卡片还带光效"
    // symptom is gone.
    expect(taskUnviewed(controller.getSnapshot().tasks[0])).toBe(false)
  })

  it('openSession selects the session on the runtime', () => {
    const { controller, sessions } = makeController()
    controller.openSession('exec-session')
    expect(sessions.openCalls).toEqual(['exec-session'])
  })

  it('openSession refuses to navigate to a session that no longer exists', () => {
    const { controller, sessions } = makeController()
    sessions.knownIds = new Set(['alive'])
    const opened = controller.openSession('gone')
    expect(opened).toBe(false)
    expect(sessions.openCalls).toEqual([]) // never navigated
  })
})

describe('run loop', () => {
  it('moves to running, attaches the session id, and settles on completion', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: '任务A', description: '', prompt: '干活' })!
    const taskId = task.id

    await controller.runTask(taskId)
    expect(exec.runCalls).toHaveLength(1)
    expect(exec.runCalls[0].taskId).toBe(taskId)
    const executionId = exec.runCalls[0].executionId
    expect(store.load()[0].status).toBe('running')

    // The execution service reports the session…
    exec.runCalls[0].fire({ kind: 'started', taskId, executionId, sessionId: 's-9' })
    expect(store.load()[0].executions[0].sessionId).toBe('s-9')
    expect(store.load()[0].status).toBe('running')

    // A second run call while running is ignored.
    await controller.runTask(taskId)
    expect(exec.runCalls).toHaveLength(1)

    // …and settles it into review (the human gate before done).
    exec.runCalls[0].fire({ kind: 'settled', taskId, executionId, outcome: 'succeeded' })
    expect(store.load()[0].status).toBe('review')
    expect(store.load()[0].executions[0].result).toBe('succeeded')
  })

  it('settles failed tasks into review (the outcome lives in the record)', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: '任务A', description: '', prompt: '干活' })!
    await controller.runTask(task.id)
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: exec.runCalls[0].executionId, outcome: 'failed', error: 'boom' })
    expect(store.load()[0].status).toBe('review')
    expect(store.load()[0].executions[0].error).toBe('boom')
  })

  it('rerunTask re-plans a settled task to todo before running again', async () => {
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: '任务A', description: '', prompt: '干活' })!
    await controller.runTask(task.id)
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: exec.runCalls[0].executionId, outcome: 'failed' })
    expect(controller.getSnapshot().tasks[0].status).toBe('review')
    await controller.rerunTask(task.id)
    expect(controller.getSnapshot().tasks[0].status).toBe('running')
    expect(exec.runCalls).toHaveLength(2)
  })

  it('reconciles running tasks left over from a previous load', async () => {
    const stub = new StubExec()
    stub.reconcileResult = { kind: 'settled', taskId: 'task-a', executionId: 'e1', outcome: 'cancelled', error: 'gone' }
    const { store } = makeController(stub)
    const task = seedTask(store, { id: 'task-a' })
    store.save([{ ...task, status: 'running', executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }] }])
    const reloaded = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions: new FakeSessions(), now: () => NOW, uuid,
    })
    reloaded.start()
    await flush()
    expect(reloaded.getSnapshot().tasks[0].status).toBe('todo')
  })

  it('settles an orphaned running execution on the next session-list change', async () => {
    const stub = new StubExec()
    stub.reconcileResult = { kind: 'settled', taskId: 'task-a', executionId: 'e1', outcome: 'cancelled', error: 'gone' }
    const store = new InMemoryTaskStore()
    const task = seedTask(store, { id: 'task-a' })
    store.save([{ ...task, status: 'running', executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }] }])
    const sessions = new FakeSessions()
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    // Start resolves while the exec still reports nothing to settle…
    stub.reconcileResult = undefined
    controller.start()
    await flush()
    expect(controller.getSnapshot().tasks[0].status).toBe('running')
    // …then a later list change settles the orphan without a page reload.
    stub.reconcileResult = { kind: 'settled', taskId: 'task-a', executionId: 'e1', outcome: 'cancelled', error: 'gone' }
    sessions.setCurrent('s-new')
    await flush()
    await flush()
    expect(controller.getSnapshot().tasks[0].status).toBe('todo')
  })

  it('coalesces a burst of session-list changes into one reconcile pass', async () => {
    let reconcileCalls = 0
    const stub = {
      runCalls: [],
      run: async () => {},
      reconcile: () => { reconcileCalls += 1; return undefined },
    }
    const store = new InMemoryTaskStore()
    const task = seedTask(store, { id: 'task-a' })
    store.save([{ ...task, status: 'running', executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }] }])
    const sessions = new FakeSessions()
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 20,
    })
    controller.start()
    await flush()
    const before = reconcileCalls
    for (let i = 0; i < 5; i += 1) sessions.setCurrent('s-' + i)
    await new Promise(resolve => { setTimeout(resolve, 50) })
    expect(reconcileCalls - before).toBe(1)
  })

  it('keeps a page-launched run running on list updates; only the watch settles it', async () => {
    const stub = new StubExec()
    const { controller, sessions, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    // Start a run; attach its session id.
    await controller.runTask(task.id)
    const executionId = exec.runCalls[0].executionId
    exec.runCalls[0].fire({ kind: 'started', taskId: task.id, executionId, sessionId: 's-1' })
    expect(store.load()[0].status).toBe('running')

    // A session-list notification (the executing session appearing in the
    // list while its turn has not started yet) must NOT settle the run via
    // reconciliation: a freshly created session is idle, not completed.
    stub.reconcileResult = { kind: 'settled', taskId: task.id, executionId, outcome: 'succeeded' }
    sessions.setCurrent('s-2')
    await flush()
    expect(store.load()[0].status).toBe('running')

    // The live watch settles on the turn boundary.
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId, outcome: 'succeeded' })
    expect(store.load()[0].status).toBe('review')
    expect(store.load()[0].executions[0].result).toBe('succeeded')
  })

  it('releases a page-launched run whose session finished once the grace window passed', async () => {
    let clock = NOW
    const stub = new StubExec()
    const sessions = new FakeSessions()
    const store = new InMemoryTaskStore()
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => clock, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    await controller.runTask(task.id)
    const executionId = stub.runCalls[0].executionId
    stub.runCalls[0].fire({ kind: 'started', taskId: task.id, executionId, sessionId: 's-1' })
    expect(store.load()[0].status).toBe('running')

    // The host reports the session finished, but the run is still inside the
    // queue-window grace: reconciliation must not settle it yet.
    stub.reconcileResult = { kind: 'settled', taskId: task.id, executionId, outcome: 'succeeded' }
    sessions.setRunning('s-1', false)
    await flush()
    await flush()
    expect(store.load()[0].status).toBe('running')

    // Past the grace window a fresh list change lets reconciliation settle
    // the run (the watch was defeated — cold session) and releases the id.
    clock = NOW + 11_000
    sessions.setRunning('s-1', false)
    await flush()
    await flush()
    expect(store.load()[0].status).toBe('review')
    expect(store.load()[0].executions[0].result).toBe('succeeded')
  })

  it('never reconciles a page-launched run while its session is still running', async () => {
    let clock = NOW
    const stub = new StubExec()
    const sessions = new FakeSessions()
    const store = new InMemoryTaskStore()
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => clock, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    await controller.runTask(task.id)
    const executionId = stub.runCalls[0].executionId
    stub.runCalls[0].fire({ kind: 'started', taskId: task.id, executionId, sessionId: 's-1' })
    stub.reconcileResult = { kind: 'settled', taskId: task.id, executionId, outcome: 'succeeded' }
    clock = NOW + 60_000
    sessions.setRunning('s-1', true) // still running on the host
    await flush()
    await flush()
    expect(store.load()[0].status).toBe('running')
  })
})

describe('scheduling', () => {
  it('setSchedule enables a rule and computes the next run instant', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    expect(controller.setSchedule(task.id, { enabled: true, cron: '* * * * *' })).toBe(true)
    const persisted = store.load()[0]
    expect(persisted.schedule?.enabled).toBe(true)
    expect(persisted.schedule?.cron).toBe('* * * * *')
    expect(persisted.schedule?.nextRunAt).toBeDefined()
  })

  it('rejects blank or invalid cron expressions without touching state', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    expect(controller.setSchedule(task.id, { enabled: true, cron: 'not a cron' })).toBe(false)
    expect(controller.setSchedule(task.id, { enabled: true, cron: '   ' })).toBe(false)
    expect(controller.setSchedule(task.id, { enabled: true })).toBe(false) // no existing cron → blank → rejected
    expect(store.load()[0].schedule).toBeUndefined()
  })

  it('disabling a rule clears the next run instant but keeps the cron', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setSchedule(task.id, { enabled: true, cron: '* * * * *' })
    expect(controller.setSchedule(task.id, { enabled: false })).toBe(true)
    const persisted = store.load()[0]
    expect(persisted.schedule?.enabled).toBe(false)
    expect(persisted.schedule?.cron).toBe('* * * * *')
    expect(persisted.schedule?.nextRunAt).toBeUndefined()
  })

  it('recomputes the next run when the cron changes while enabled', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setSchedule(task.id, { enabled: true, cron: '* * * * *' })
    const first = store.load()[0].schedule?.nextRunAt
    controller.setSchedule(task.id, { cron: '*/5 * * * *' })
    const second = store.load()[0].schedule?.nextRunAt
    expect(second).toBeDefined()
    expect(second).not.toBe(first)
  })

  it('applyScheduleNextRun rolls the schedule forward for the scheduler', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setSchedule(task.id, { enabled: true, cron: '* * * * *' })
    controller.applyScheduleNextRun(task.id, 1_234_567_890, 1_234_500_000)
    const persisted = store.load()[0]
    expect(persisted.schedule?.nextRunAt).toBe(1_234_567_890)
    expect(persisted.schedule?.lastTriggeredAt).toBe(1_234_500_000)
  })

  it('applyScheduleNextRun is a no-op for tasks without a schedule rule', () => {
    const { controller } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    expect(() => controller.applyScheduleNextRun(task.id, 1, 2)).not.toThrow()
    expect(controller.getSnapshot().tasks[0].schedule).toBeUndefined()
  })

  it('keeps a budgeted scheduled batch running until the final run settles', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setSchedule(task.id, { enabled: true, cron: '* * * * *', maxRuns: 3 })

    // Run 1 settles succeeded → the batch is not complete, the card stays
    // 'running' so the scheduler can fire the next run.
    await controller.runTask(task.id)
    const e1 = exec.runCalls[0].executionId
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: e1, outcome: 'succeeded' })
    expect(store.load()[0].status).toBe('running')
    expect(store.load()[0].executions[0].result).toBe('succeeded')
    // The scheduler increments the run counter after the settle.
    controller.applyScheduleNextRun(task.id, NOW + 60_000, NOW, 1)

    // Run 2 (a settled latest execution frees the run slot).
    await controller.runTask(task.id)
    expect(exec.runCalls).toHaveLength(2)
    const e2 = exec.runCalls[1].executionId
    exec.runCalls[1].fire({ kind: 'settled', taskId: task.id, executionId: e2, outcome: 'succeeded' })
    expect(store.load()[0].status).toBe('running')
    controller.applyScheduleNextRun(task.id, NOW + 120_000, NOW, 2)

    // Run 3 is the final budgeted run → review (the human gate).
    await controller.runTask(task.id)
    const e3 = exec.runCalls[2].executionId
    exec.runCalls[2].fire({ kind: 'settled', taskId: task.id, executionId: e3, outcome: 'succeeded' })
    expect(store.load()[0].status).toBe('review')
    expect(store.load()[0].executions).toHaveLength(3)
  })

  it('a failed batch run settles into review and frees the next run slot', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setSchedule(task.id, { enabled: true, cron: '* * * * *', maxRuns: 2 })
    await controller.runTask(task.id)
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: exec.runCalls[0].executionId, outcome: 'failed', error: 'boom' })
    expect(store.load()[0].status).toBe('review')
    // The next tick may retry: the latest execution is settled.
    await controller.runTask(task.id)
    expect(exec.runCalls).toHaveLength(2)
  })

  it('chain mode: arming starts the first run and the chain continues until the budget', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setSchedule(task.id, { enabled: true, mode: 'chain', maxRuns: 2 })
    // Arming a chain launches its first run right away (no manual prime).
    expect(exec.runCalls).toHaveLength(1)
    // Run 1 settles → the chain hands off to run 2 synchronously.
    const e1 = exec.runCalls[0].executionId
    exec.runCalls[0].fire({ kind: 'started', taskId: task.id, executionId: e1, sessionId: 's-1' })
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: e1, outcome: 'succeeded' })
    expect(exec.runCalls).toHaveLength(2)
    expect(store.load()[0].schedule?.runCount).toBe(1)
    expect(store.load()[0].schedule?.enabled).toBe(true)
    expect(store.load()[0].status).toBe('running') // chain keeps the card in progress
    // Run 2 is the final budgeted run → disarmed, settled into review, no run 3.
    const e2 = exec.runCalls[1].executionId
    exec.runCalls[1].fire({ kind: 'started', taskId: task.id, executionId: e2, sessionId: 's-2' })
    exec.runCalls[1].fire({ kind: 'settled', taskId: task.id, executionId: e2, outcome: 'succeeded' })
    expect(exec.runCalls).toHaveLength(2)
    const final = store.load()[0]
    expect(final.schedule?.enabled).toBe(false)
    expect(final.schedule?.runCount).toBe(2)
    expect(final.status).toBe('review')
  })

  it('chain mode: a failed run stops the chain', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setSchedule(task.id, { enabled: true, mode: 'chain', maxRuns: 2 })
    // The chain's first run starts on arming.
    expect(exec.runCalls).toHaveLength(1)
    const e1 = exec.runCalls[0].executionId
    exec.runCalls[0].fire({ kind: 'started', taskId: task.id, executionId: e1, sessionId: 's-1' })
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: e1, outcome: 'failed', error: 'boom' })
    expect(exec.runCalls).toHaveLength(1) // no hand-off after a failure
    expect(store.load()[0].status).toBe('review')
    expect(store.load()[0].schedule?.enabled).toBe(true) // stays armed (paused on review)
  })

  it('manually moving a running chain card to todo stops the chain (manual takeover)', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setSchedule(task.id, { enabled: true, mode: 'chain', maxRuns: undefined })
    expect(exec.runCalls).toHaveLength(1) // armed chain starts immediately
    const e1 = exec.runCalls[0].executionId
    exec.runCalls[0].fire({ kind: 'started', taskId: task.id, executionId: e1, sessionId: 's-1' })
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: e1, outcome: 'succeeded' })
    expect(exec.runCalls).toHaveLength(2) // the chain hands off to the next run
    // Manual takeover: dragging the chain card to todo stops the chain (a
    // todo card would otherwise chain right back) — it never blocks the move.
    controller.moveTask(task.id, 'todo')
    const after = store.load()[0]
    expect(after.schedule?.enabled).toBe(false)
    expect(after.status).toBe('todo')
  })

  it('an armed-but-never-run chain in backlog starts its first run when moved to todo', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run', status: 'backlog' })!
    controller.setSchedule(task.id, { enabled: true, mode: 'chain', maxRuns: 2 })
    // Armed while shelved (backlog): paused, nothing runs yet.
    expect(exec.runCalls).toHaveLength(0)
    expect(store.load()[0].schedule?.enabled).toBe(true)
    // Moving it to todo resumes the chain — the first run starts.
    controller.moveTask(task.id, 'todo')
    expect(exec.runCalls).toHaveLength(1)
    expect(store.load()[0].status).toBe('running')
    expect(store.load()[0].schedule?.enabled).toBe(true)
  })

  it('stopping a chain only disarms the rule without moving the card', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setSchedule(task.id, { enabled: true, mode: 'chain', maxRuns: undefined })
    expect(exec.runCalls).toHaveLength(1)
    const e1 = exec.runCalls[0].executionId
    exec.runCalls[0].fire({ kind: 'started', taskId: task.id, executionId: e1, sessionId: 's-1' })
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: e1, outcome: 'succeeded' })
    expect(exec.runCalls).toHaveLength(2) // second chained run is open
    // "Stop chaining": only the rule disarms — the card stays exactly where
    // it is (running, in-flight run untouched).
    controller.setSchedule(task.id, { enabled: false, mode: 'chain' })
    const after = store.load()[0]
    expect(after.schedule?.enabled).toBe(false)
    expect(after.status).toBe('running')
    // The in-flight run still settles to review — no third chain run.
    const e2 = exec.runCalls[1].executionId
    exec.runCalls[1].fire({ kind: 'started', taskId: task.id, executionId: e2, sessionId: 's-2' })
    exec.runCalls[1].fire({ kind: 'settled', taskId: task.id, executionId: e2, outcome: 'succeeded' })
    expect(exec.runCalls).toHaveLength(2)
    expect(store.load()[0].status).toBe('review')
  })

  it('manual runs never touch the schedule counters or next-run instant', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setSchedule(task.id, { enabled: true, cron: '* * * * *', maxRuns: 3 })
    const before = store.load()[0].schedule
    await controller.runTask(task.id) // e.g. dragging the card to 'running'
    expect(store.load()[0].schedule?.runCount).toBe(before?.runCount)
    expect(store.load()[0].schedule?.nextRunAt).toBe(before?.nextRunAt)
    exec.runCalls[0].fire({ kind: 'started', taskId: task.id, executionId: exec.runCalls[0].executionId, sessionId: 's-1' })
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: exec.runCalls[0].executionId, outcome: 'succeeded' })
    // cron mode: no continuation; the counters stay untouched.
    expect(exec.runCalls).toHaveLength(1)
    expect(store.load()[0].schedule?.runCount).toBe(before?.runCount)
  })

  it('mode switches keep a known cron expression; cron mode still demands one', () => {
    const stub = new StubExec()
    const { controller, store } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    // Arm in cron mode with a valid expression.
    expect(controller.setSchedule(task.id, { enabled: true, cron: '0 9 * * *' })).toBe(true)
    // Switch to chain: the expression survives the mode change (chain never
    // clears the stored cron).
    expect(controller.setSchedule(task.id, { mode: 'chain' })).toBe(true)
    expect(store.load()[0].schedule?.cron).toBe('0 9 * * *')
    // Switch back to cron: accepted with the preserved expression.
    expect(controller.setSchedule(task.id, { mode: 'cron' })).toBe(true)
    expect(store.load()[0].schedule?.mode).toBe('cron')
    expect(store.load()[0].schedule?.cron).toBe('0 9 * * *')
    // Arming a chain on a fresh task leaves no cron; cron mode still rejects
    // an empty expression (the UI saves one before switching back).
    const fresh = controller.createTask({ title: 'y', description: '', prompt: 'run' })!
    expect(controller.setSchedule(fresh.id, { enabled: true, mode: 'chain' })).toBe(true)
    expect(controller.setSchedule(fresh.id, { mode: 'cron' })).toBe(false)
    expect(controller.setSchedule(fresh.id, { mode: 'cron', cron: '*/5 * * * *' })).toBe(true)
  })
})

describe('session config face', () => {
  it('exposes the injected face and degrades to undefined without one', () => {
    const { controller } = makeController()
    expect(controller.sessionConfig()).toBeUndefined()
    const face = {
      readModels: async () => ({ current: { provider: 'p', model: 'm' }, groups: [] }),
      selectModel: async () => ({ ok: true as const }),
      setPermission: async () => ({ ok: true as const }),
    }
    const { controller: wired } = makeController(new StubExec(), { sessionConfig: face })
    expect(wired.sessionConfig()).toBe(face)
  })
})

describe('comments', () => {
  /** A task with one settled execution in review (session s-1). */
  async function settledReviewTask(stub: StubExec, controller: BoardController): Promise<{ taskId: string; executionId: string }> {
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    await controller.runTask(task.id)
    const run = stub.runCalls[stub.runCalls.length - 1]
    run.fire({ kind: 'started', taskId: task.id, executionId: run.executionId, sessionId: 's-1' })
    run.fire({ kind: 'settled', taskId: task.id, executionId: run.executionId, outcome: 'succeeded' })
    return { taskId: task.id, executionId: run.executionId }
  }

  it('saves a pending comment round; nothing is injected while the cruise is off', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const { taskId, executionId } = await settledReviewTask(stub, controller)
    expect(store.load()[0].status).toBe('review')
    const round = controller.submitComment(taskId, executionId, ' 继续下一步 ')
    expect(round).toBeDefined()
    expect(round?.comment).toBe('继续下一步')
    expect(round?.sessionId).toBe('s-1')
    // The round records the execution it continues, so the review page can
    // show each execution's own comments.
    expect(round?.parentExecutionId).toBe(executionId)
    expect(store.load()[0].executions[1].parentExecutionId).toBe(executionId)
    expect(exec.commentCalls).toHaveLength(0)
    expect(store.load()[0].status).toBe('review')
    // Comments are a per-task FIFO queue: more can be saved while the cruise
    // is off (all stay uninjected until it turns on).
    expect(controller.submitComment(taskId, executionId, '再一句')?.comment).toBe('再一句')
    expect(store.load()[0].executions).toHaveLength(3)
    expect(store.load()[0].executions[1].injectedAt).toBeUndefined()
    expect(store.load()[0].executions[2].injectedAt).toBeUndefined()
  })

  it('rejects comments on unknown tasks, unsettled runs, or blank text', async () => {
    const stub = new StubExec()
    const { controller } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    await controller.runTask(task.id)
    const openExecutionId = stub.runCalls[0].executionId
    expect(controller.submitComment(task.id, 'ghost', 'hi')).toBeUndefined()
    expect(controller.submitComment('ghost', 'ghost', 'hi')).toBeUndefined()
    expect(controller.submitComment(task.id, openExecutionId, 'hi')).toBeUndefined() // not settled
    expect(controller.submitComment(task.id, openExecutionId, '   ')).toBeUndefined()
  })

  it('injects pending comments when the cruise turns on and settles back into review', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const { taskId, executionId } = await settledReviewTask(stub, controller)
    controller.submitComment(taskId, executionId, '继续')
    controller.setCruiseEnabled(true)
    expect(exec.commentCalls).toHaveLength(1)
    expect(exec.commentCalls[0].sessionId).toBe('s-1')
    expect(exec.commentCalls[0].text).toBe('继续')
    expect(store.load()[0].status).toBe('running')
    // The comment round settles through the normal event path → review again.
    exec.commentCalls[0].fire({ kind: 'settled', taskId, executionId: exec.commentCalls[0].executionId, outcome: 'succeeded' })
    expect(store.load()[0].status).toBe('review')
    expect(store.load()[0].executions).toHaveLength(2)
    expect(store.load()[0].executions[1].comment).toBe('继续')
    expect(store.load()[0].executions[1].result).toBe('succeeded')
  })

  it('injects a comment immediately when the cruise is already on', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    controller.setCruiseEnabled(true)
    const { taskId, executionId } = await settledReviewTask(stub, controller)
    controller.submitComment(taskId, executionId, '马上干')
    expect(exec.commentCalls).toHaveLength(1)
    expect(store.load()[0].status).toBe('running')
  })

  it('a failed comment round reports the error and lands in review', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    controller.setCruiseEnabled(true)
    const { taskId, executionId } = await settledReviewTask(stub, controller)
    controller.submitComment(taskId, executionId, '改一下')
    exec.commentCalls[0].fire({ kind: 'settled', taskId, executionId: exec.commentCalls[0].executionId, outcome: 'failed', error: 'boom' })
    expect(store.load()[0].status).toBe('review')
    expect(store.load()[0].executions[1].result).toBe('failed')
    expect(store.load()[0].executions[1].error).toBe('boom')
  })

  it('injects pending comments on todo/backlog tasks when the cruise turns on', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const { taskId, executionId } = await settledReviewTask(stub, controller)
    // Re-plan to todo and comment: the round stays pending (cruise off).
    controller.moveTask(taskId, 'todo')
    controller.submitComment(taskId, executionId, '待办里继续')
    expect(exec.commentCalls).toHaveLength(0)
    // Cruise on → the comment injects from todo.
    controller.setCruiseEnabled(true)
    expect(exec.commentCalls).toHaveLength(1)
    expect(store.load()[0].status).toBe('running')
    // With the cruise on, a comment on a backlog-shelved task injects at once.
    const second = await settledReviewTask(stub, controller)
    controller.moveTask(second.taskId, 'backlog')
    controller.submitComment(second.taskId, second.executionId, '从待规划继续')
    expect(exec.commentCalls).toHaveLength(2)
  })

  it('revives a completed task when a comment is submitted (moved back to 待办, no dead end)', async () => {
    const stub = new StubExec()
    const { controller, store } = makeController(stub)
    const { taskId, executionId } = await settledReviewTask(stub, controller)
    controller.moveTask(taskId, 'done')
    expect(store.load()[0].status).toBe('done')
    // The comment is NOT rejected: the task moves back to 待办 (the same
    // column transition as a drag) and the comment queues to drive it.
    const round = controller.submitComment(taskId, executionId, '完成了还评？')
    expect(round).toBeDefined()
    expect(store.load()[0].status).toBe('todo')
    expect(store.load()[0].executions).toHaveLength(2)
  })

  it('flags slash-command comments and injects them through the command path', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    controller.setCruiseEnabled(true)
    const { taskId, executionId } = await settledReviewTask(stub, controller)
    const round = controller.submitComment(taskId, executionId, '/plan 继续干', true)
    expect(round).toBeDefined()
    expect(round?.command).toBe(true)
    expect(store.load()[0].executions[1].command).toBe(true)
    // A plain comment stays unflagged.
    expect(controller.submitComment(taskId, executionId, '普通评论')?.command).toBeUndefined()
    expect(exec.commentCalls).toHaveLength(1) // only the command round injected
    expect(exec.commentCalls[0].text).toBe('/plan 继续干')
  })

  it('keeps a comment pending while the task is running', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    controller.setCruiseEnabled(true)
    const { taskId, executionId } = await settledReviewTask(stub, controller)
    // A second run puts the task back to running; a comment then stays
    // pending (the session is busy) instead of injecting.
    await controller.runTask(taskId)
    expect(store.load()[0].status).toBe('running')
    const round = controller.submitComment(taskId, executionId, '先存着')
    expect(round).toBeDefined()
    expect(exec.commentCalls).toHaveLength(0)
    expect(round?.endedAt).toBeUndefined()
  })

  it('injects a pending comment when the run settles back (cruise on)', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    controller.setCruiseEnabled(true)
    const { taskId, executionId } = await settledReviewTask(stub, controller)
    // The task runs again; a comment saved while running stays pending.
    await controller.runTask(taskId)
    const run = stub.runCalls[stub.runCalls.length - 1]
    controller.submitComment(taskId, executionId, '等结算后注入')
    expect(exec.commentCalls).toHaveLength(0)
    // The run settles → the task is drivable again → the pending comment
    // injects automatically.
    run.fire({ kind: 'settled', taskId, executionId: run.executionId, outcome: 'succeeded' })
    expect(exec.commentCalls).toHaveLength(1)
    expect(store.load()[0].status).toBe('running')
  })

  it('a pending comment never blocks a fresh run (run guard ignores it)', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const { taskId, executionId } = await settledReviewTask(stub, controller)
    // Save a pending comment (cruise off), then run the task again: the
    // pending round must not count as an open run.
    controller.submitComment(taskId, executionId, '挂着')
    await controller.runTask(taskId)
    expect(exec.runCalls.length).toBeGreaterThanOrEqual(2)
    expect(store.load()[0].status).toBe('running')
  })

  it('cancelComment removes only pending rounds', async () => {
    const stub = new StubExec()
    const { controller, store } = makeController(stub)
    const { taskId, executionId } = await settledReviewTask(stub, controller)
    const pending = controller.submitComment(taskId, executionId, '发错了')
    expect(pending).toBeDefined()
    expect(store.load()[0].executions).toHaveLength(2)
    // Cancel the pending round.
    expect(controller.cancelComment(pending!.id)).toBe(true)
    expect(store.load()[0].executions).toHaveLength(1)
    // A settled round cannot be cancelled.
    expect(controller.cancelComment(executionId)).toBe(false)
    // An injected (running) round cannot be cancelled either.
    controller.setCruiseEnabled(true)
    const second = controller.submitComment(taskId, executionId, '又一条')
    expect(second).toBeDefined()
    expect(store.load()[0].status).toBe('running')
    expect(controller.cancelComment(second!.id)).toBe(false)
  })
})

describe('submitSessionComment (drive-mode linked-session comments)', () => {
  /** A task with one settled execution in review (session s-1). */
  async function settledReviewTask(stub: StubExec, controller: BoardController): Promise<{ taskId: string; executionId: string }> {
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    await controller.runTask(task.id)
    const run = stub.runCalls[stub.runCalls.length - 1]
    run.fire({ kind: 'started', taskId: task.id, executionId: run.executionId, sessionId: 's-1' })
    run.fire({ kind: 'settled', taskId: task.id, executionId: run.executionId, outcome: 'succeeded' })
    return { taskId: task.id, executionId: run.executionId }
  }

  it('saves a session-anchored comment round; nothing injects while the cruise is off', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    const round = controller.submitSessionComment(task.id, 'linked-7', ' 驱动一下 ')
    expect(round).toBeDefined()
    expect(round?.comment).toBe('驱动一下')
    expect(round?.sessionId).toBe('linked-7')
    expect(round?.sessionAnchor).toBe('linked-7')
    expect(round?.parentExecutionId).toBeUndefined()
    expect(store.load()[0].executions[0].sessionAnchor).toBe('linked-7')
    expect(exec.commentCalls).toHaveLength(0)
    expect(store.load()[0].status).toBe('todo')
  })

  it('rejects blank text and unknown tasks; a completed task is revived by its comment', async () => {
    const stub = new StubExec()
    const { controller, store } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    expect(controller.submitSessionComment(task.id, 'linked-7', '   ')).toBeUndefined()
    expect(controller.submitSessionComment('ghost', 'linked-7', 'hi')).toBeUndefined()
    controller.moveTask(task.id, 'done')
    const round = controller.submitSessionComment(task.id, 'linked-7', '完成了还评？')
    expect(round).toBeDefined()
    expect(store.load()[0].status).toBe('todo')
    expect(store.load()[0].executions).toHaveLength(1)
  })

  it('injects the session-anchored comment into the linked session and settles into review', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    // A saved comment outranks a fresh cruise pickup: with the cruise off the
    // round stays saved, and turning the cruise on injects it first (instead
    // of starting a fresh run of the todo task).
    controller.submitSessionComment(task.id, 'linked-7', '继续干')
    expect(exec.commentCalls).toHaveLength(0)
    controller.setCruiseEnabled(true)
    expect(exec.commentCalls).toHaveLength(1)
    expect(exec.commentCalls[0].sessionId).toBe('linked-7')
    expect(exec.commentCalls[0].text).toBe('继续干')
    expect(store.load()[0].status).toBe('running')
    exec.commentCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: exec.commentCalls[0].executionId, outcome: 'succeeded' })
    expect(store.load()[0].status).toBe('review')
    expect(store.load()[0].executions[0].sessionAnchor).toBe('linked-7')
    expect(store.load()[0].executions[0].injectedAt).toBeDefined()
    expect(store.load()[0].executions[0].result).toBe('succeeded')
  })

  it('queues a session-anchored comment behind an execution-anchored one (per-task FIFO)', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const { taskId, executionId } = await settledReviewTask(stub, controller)
    // First an execution-anchored comment (cruise off, stays saved)…
    controller.submitComment(taskId, executionId, '先从执行')
    // …then a session-anchored one into a linked session.
    controller.submitSessionComment(taskId, 'linked-7', '再驱动')
    expect(store.load()[0].executions.filter(round => round.comment !== undefined)).toHaveLength(2)
    // Cruise on → the earliest round injects first (FIFO).
    controller.setCruiseEnabled(true)
    expect(exec.commentCalls).toHaveLength(1)
    expect(exec.commentCalls[0].sessionId).toBe('s-1')
    // It settles → the next pending round injects into the linked session.
    exec.commentCalls[0].fire({ kind: 'settled', taskId, executionId: exec.commentCalls[0].executionId, outcome: 'succeeded' })
    expect(exec.commentCalls).toHaveLength(2)
    expect(exec.commentCalls[1].sessionId).toBe('linked-7')
    expect(store.load()[0].status).toBe('running')
  })

  it('cancels a pending session-anchored comment but never an injected one', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    const pending = controller.submitSessionComment(task.id, 'linked-7', '发错了')
    expect(controller.cancelComment(pending!.id)).toBe(true)
    expect(store.load()[0].executions).toEqual([])
    // A saved comment outranks a fresh pickup: turn the cruise on only after
    // saving, so it injects immediately and can no longer be cancelled.
    const second = controller.submitSessionComment(task.id, 'linked-7', '又一条')
    expect(second).toBeDefined()
    expect(exec.commentCalls).toHaveLength(0)
    controller.setCruiseEnabled(true)
    expect(exec.commentCalls).toHaveLength(1)
    expect(controller.cancelComment(second!.id)).toBe(false)
  })
})

describe('auto-cruise', () => {
  it('defaults to off with a limit of 5 when nothing is stored', () => {
    const { controller } = makeController()
    expect(controller.getSnapshot().cruise).toEqual({ enabled: false, limit: 5, schedule: [] })
  })

  it('persists toggle and limit through the storage face', () => {
    const writes: Array<{ enabled: boolean; manual?: boolean; limit: number; schedule: CruiseWindow[] }> = []
    const storage = {
      read: (): { enabled: boolean; manual?: boolean; limit: number; schedule: CruiseWindow[] } | undefined => writes[writes.length - 1],
      write: (state: { enabled: boolean; manual?: boolean; limit: number; schedule: CruiseWindow[] }): void => { writes.push(state) },
    }
    const { controller } = makeController(new StubExec(), { cruiseStorage: storage })
    controller.setCruiseEnabled(true)
    controller.setCruiseLimit(3)
    // Manual ON flips enabled and records the manual intent — the schedule is
    // NEVER written, so toggling cannot accumulate window records.
    expect(writes).toEqual([
      { enabled: true, manual: true, limit: 5, schedule: [] },
      { enabled: true, manual: true, limit: 3, schedule: [] },
    ])
    expect(controller.getSnapshot().cruise).toEqual({ enabled: true, manual: true, limit: 3, schedule: [] })
    // Clamped to ≥ 1.
    controller.setCruiseLimit(0)
    expect(controller.getSnapshot().cruise.limit).toBe(1)
  })

  it('restores a persisted enabled cruise on start and pumps the queue', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub, {
      cruiseStorage: { read: () => ({ enabled: true, limit: 2 }), write: () => {} },
    })
    controller.createTask({ title: 'a', description: '', prompt: 'run' })!
    controller.createTask({ title: 'b', description: '', prompt: 'run' })!
    controller.createTask({ title: 'c', description: '', prompt: 'run' })!
    expect(exec.runCalls).toHaveLength(2) // limit 2
    expect(store.load().filter(task => task.status === 'running')).toHaveLength(2)
  })

  it('runs todo tasks up to the limit and refills when one settles', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const a = controller.createTask({ title: 'a', description: '', prompt: 'run' })!
    const b = controller.createTask({ title: 'b', description: '', prompt: 'run' })!
    const c = controller.createTask({ title: 'c', description: '', prompt: 'run' })!
    controller.setCruiseLimit(2)
    controller.setCruiseEnabled(true)
    expect(exec.runCalls).toHaveLength(2)
    expect(store.load().filter(task => task.status === 'running')).toHaveLength(2)
    // One run settles → the freed slot picks up the remaining todo.
    exec.runCalls[0].fire({ kind: 'settled', taskId: a.id, executionId: exec.runCalls[0].executionId, outcome: 'succeeded' })
    expect(exec.runCalls).toHaveLength(3)
    expect(store.load().find(task => task.id === c.id)?.status).toBe('running')
    expect(store.load().find(task => task.id === a.id)?.status).toBe('review')
    // Review tasks are never re-picked by the cruise.
    expect(store.load().find(task => task.id === b.id)?.status).toBe('running')
  })

  it('disabling stops picking new tasks; in-flight runs finish', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const a = controller.createTask({ title: 'a', description: '', prompt: 'run' })!
    controller.createTask({ title: 'b', description: '', prompt: 'run' })!
    controller.setCruiseLimit(1)
    controller.setCruiseEnabled(true)
    expect(exec.runCalls).toHaveLength(1)
    controller.setCruiseEnabled(false)
    exec.runCalls[0].fire({ kind: 'settled', taskId: a.id, executionId: exec.runCalls[0].executionId, outcome: 'succeeded' })
    expect(exec.runCalls).toHaveLength(1) // no refill while off
    expect(store.load().find(task => task.id === a.id)?.status).toBe('review')
  })
})

describe('unified dispatch (one concurrency budget)', () => {
  /** A task with one settled execution in review (session s-1). */
  async function settledTask(stub: StubExec, controller: BoardController): Promise<{ taskId: string; executionId: string }> {
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    await controller.runTask(task.id)
    const run = stub.runCalls[stub.runCalls.length - 1]
    run.fire({ kind: 'started', taskId: task.id, executionId: run.executionId, sessionId: 's-1' })
    run.fire({ kind: 'settled', taskId: task.id, executionId: run.executionId, outcome: 'succeeded' })
    return { taskId: task.id, executionId: run.executionId }
  }

  it('caps the total in-flight rounds (comments + cruise) at the budget', async () => {
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub)
    controller.setCruiseLimit(1)
    // One cruise slot is taken by a todo pickup.
    const a = controller.createTask({ title: 'a', description: '', prompt: 'run' })!
    controller.setCruiseEnabled(true)
    expect(exec.runCalls).toHaveLength(1)
    // A comment round queues: the budget is full, so it must not inject.
    const { taskId, executionId } = await settledTask(stub, controller)
    controller.submitComment(taskId, executionId, '排队等槽位')
    expect(exec.commentCalls).toHaveLength(0)
    // The cruise run settles → the freed slot goes to the comment first.
    exec.runCalls[0].fire({ kind: 'settled', taskId: a.id, executionId: exec.runCalls[0].executionId, outcome: 'succeeded' })
    expect(exec.commentCalls).toHaveLength(1)
    expect(exec.commentCalls[0].text).toBe('排队等槽位')
    expect(controller.getSnapshot().tasks.find(task => task.id === taskId)?.status).toBe('running')
  })

  it('runs a task queued comments strictly in order, one round at a time', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    controller.setCruiseEnabled(true)
    const { taskId, executionId } = await settledTask(stub, controller)
    // The first comment injects immediately (budget free)…
    controller.submitComment(taskId, executionId, '第一句')
    expect(exec.commentCalls).toHaveLength(1)
    // …a second comment queues while the first is running…
    controller.submitComment(taskId, executionId, '第二句')
    expect(exec.commentCalls).toHaveLength(1)
    expect(store.load()[0].executions[2].injectedAt).toBeUndefined()
    // …and injects only after the first settles.
    exec.commentCalls[0].fire({ kind: 'settled', taskId, executionId: exec.commentCalls[0].executionId, outcome: 'succeeded' })
    expect(exec.commentCalls).toHaveLength(2)
    expect(exec.commentCalls[1].text).toBe('第二句')
    expect(controller.getSnapshot().tasks[0].status).toBe('running')
  })

  it('injects queued comments across tasks in submission order', async () => {
    const stub = new StubExec()
    let clock = NOW
    const { controller, stub: exec } = makeController(stub, { now: () => clock })
    controller.setCruiseLimit(1)
    controller.setCruiseEnabled(true)
    // Occupy the only slot with a todo pickup.
    const a = controller.createTask({ title: 'a', description: '', prompt: 'run' })!
    expect(exec.runCalls).toHaveLength(1)
    // Two review tasks each get a queued comment (the budget is full).
    const first = await settledTask(stub, controller)
    const second = await settledTask(stub, controller)
    controller.submitComment(first.taskId, first.executionId, '先提交')
    clock += 1
    controller.submitComment(second.taskId, second.executionId, '后提交')
    expect(exec.commentCalls).toHaveLength(0)
    // The slot frees → the earlier-submitted comment injects first.
    exec.runCalls[0].fire({ kind: 'settled', taskId: a.id, executionId: exec.runCalls[0].executionId, outcome: 'succeeded' })
    expect(exec.commentCalls).toHaveLength(1)
    expect(exec.commentCalls[0].text).toBe('先提交')
    expect(exec.commentCalls[0].sessionId).toBe('s-1')
  })

  it('cancels an uninjected queued comment even while another round of the same task runs', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    controller.setCruiseEnabled(true)
    const { taskId, executionId } = await settledTask(stub, controller)
    controller.submitComment(taskId, executionId, '第一条')
    expect(exec.commentCalls).toHaveLength(1) // running
    const queued = controller.submitComment(taskId, executionId, '第二条')
    expect(queued).toBeDefined()
    expect(controller.cancelComment(queued!.id)).toBe(true)
    expect(store.load()[0].executions).toHaveLength(2) // run + first comment
    // An injected round cannot be cancelled.
    expect(controller.cancelComment(exec.commentCalls[0].executionId)).toBe(false)
  })

  it('never injects queued comments for completed tasks', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    controller.setCruiseLimit(1)
    controller.setCruiseEnabled(true)
    controller.createTask({ title: 'a', description: '', prompt: 'run' })! // occupies the slot
    const { taskId, executionId } = await settledTask(stub, controller)
    const round = controller.submitComment(taskId, executionId, '别跑')
    expect(round).toBeDefined()
    expect(exec.commentCalls).toHaveLength(0)
    controller.moveTask(taskId, 'done')
    // The slot frees, but the done task's comment stays uninjected.
    exec.runCalls[0].fire({ kind: 'settled', taskId: 'a', executionId: exec.runCalls[0].executionId, outcome: 'succeeded' })
    expect(exec.commentCalls).toHaveLength(0)
    expect(store.load().find(task => task.id === taskId)?.executions.filter(e => e.comment !== undefined)).toHaveLength(1)
    // Still cancellable (never injected).
    expect(controller.cancelComment(round!.id)).toBe(true)
  })

  it('automation never starts a blank-prompt task (the new-task default stays idle until content exists)', async () => {
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub)
    const blank = controller.createTask({ title: '空', description: '', prompt: '   ' })!
    const real = controller.createTask({ title: '有内容', description: '', prompt: 'run' })!
    controller.setCruiseEnabled(true)
    expect(exec.runCalls).toHaveLength(1) // only the content-carrying task picked up
    expect(exec.runCalls[0].taskId).toBe(real.id)
    // Filling the prompt makes it eligible again on the next pump.
    controller.updateTask(blank.id, { prompt: '做点什么' })
    controller.setCruiseEnabled(false)
    controller.setCruiseEnabled(true)
    expect(exec.runCalls).toHaveLength(2)
    expect(exec.runCalls[1].taskId).toBe(blank.id)
  })

  it('manual runs start immediately even when the budget is full (and occupy a slot)', async () => {
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub)
    controller.setCruiseLimit(1)
    controller.setCruiseEnabled(true)
    const a = controller.createTask({ title: 'a', description: '', prompt: 'run' })!
    const b = controller.createTask({ title: 'b', description: '', prompt: 'run' })!
    expect(exec.runCalls).toHaveLength(1) // a picked by cruise
    // Manual run of b: accepted even though the budget is full.
    await controller.runTask(b.id, 'manual')
    expect(exec.runCalls).toHaveLength(2)
    expect(controller.getSnapshot().tasks.find(task => task.id === b.id)?.status).toBe('running')
    // A third todo waits for a slot.
    controller.createTask({ title: 'c', description: '', prompt: 'run' })!
    expect(exec.runCalls).toHaveLength(2)
    // a settles → b still occupies the only slot → nothing new starts.
    exec.runCalls[0].fire({ kind: 'settled', taskId: a.id, executionId: exec.runCalls[0].executionId, outcome: 'succeeded' })
    expect(exec.runCalls).toHaveLength(2)
    // b settles → the slot frees → c starts.
    exec.runCalls[1].fire({ kind: 'settled', taskId: b.id, executionId: exec.runCalls[1].executionId, outcome: 'succeeded' })
    expect(exec.runCalls).toHaveLength(3)
  })

  it('drops a queued auto launch when the task goes stale (done / busy / deleted)', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    controller.setCruiseLimit(1)
    controller.setCruiseEnabled(true)
    const a = controller.createTask({ title: 'a', description: '', prompt: 'run' })!
    const b = controller.createTask({ title: 'b', description: '', prompt: 'run' })!
    expect(exec.runCalls).toHaveLength(1) // a picked; the budget is full
    // A schedule trigger for b is accepted but queued (budget full).
    await expect(controller.runTask(b.id, 'schedule')).resolves.toBe(true)
    expect(exec.runCalls).toHaveLength(1)
    // b is moved to done before the slot frees → the queued launch is dropped.
    controller.moveTask(b.id, 'done')
    exec.runCalls[0].fire({ kind: 'settled', taskId: a.id, executionId: exec.runCalls[0].executionId, outcome: 'succeeded' })
    expect(exec.runCalls).toHaveLength(1)
    expect(store.load().find(task => task.id === b.id)?.status).toBe('done')
  })

  it('chain hand-offs respect the budget (queued until a slot frees)', async () => {
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub)
    controller.setCruiseLimit(1)
    const a = controller.createTask({ title: 'a', description: '', prompt: 'run' })!
    controller.setSchedule(a.id, { enabled: true, mode: 'chain' })
    controller.setCruiseEnabled(true)
    expect(exec.runCalls).toHaveLength(1) // a auto-started by arming the chain
    const b = controller.createTask({ title: 'b', description: '', prompt: 'run' })!
    await controller.runTask(b.id, 'manual') // manual run occupies the slot beyond the budget
    expect(exec.runCalls).toHaveLength(2)
    // a settles → chain hand-off queues (b still occupies the only slot).
    exec.runCalls[0].fire({ kind: 'settled', taskId: a.id, executionId: exec.runCalls[0].executionId, outcome: 'succeeded' })
    expect(exec.runCalls).toHaveLength(2)
    // b settles → the freed slot starts the chained run.
    exec.runCalls[1].fire({ kind: 'settled', taskId: b.id, executionId: exec.runCalls[1].executionId, outcome: 'succeeded' })
    expect(exec.runCalls).toHaveLength(3)
    expect(exec.runCalls[2].taskId).toBe(a.id)
    expect(controller.getSnapshot().tasks.find(task => task.id === a.id)?.status).toBe('running')
  })

  it('raising the budget re-pumps; lowering it never aborts in-flight runs', async () => {
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub)
    controller.setCruiseLimit(1)
    controller.setCruiseEnabled(true)
    controller.createTask({ title: 'a', description: '', prompt: 'run' })!
    controller.createTask({ title: 'b', description: '', prompt: 'run' })!
    expect(exec.runCalls).toHaveLength(1)
    controller.setCruiseLimit(2)
    expect(exec.runCalls).toHaveLength(2)
    controller.setCruiseLimit(1)
    expect(exec.runCalls).toHaveLength(2) // nothing aborted
  })

  it('never starts a task already running (from any surface)', async () => {
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub)
    const a = controller.createTask({ title: 'a', description: '', prompt: 'run' })!
    await controller.runTask(a.id, 'manual')
    controller.createTask({ title: 'b', description: '', prompt: 'run' })!
    controller.setCruiseEnabled(true)
    expect(exec.runCalls).toHaveLength(2) // a manual + b cruise
    expect(exec.runCalls.filter(call => call.taskId === a.id)).toHaveLength(1)
  })

  it('dispose stops the dispatcher (no launches after dispose)', async () => {
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub)
    controller.setCruiseEnabled(true)
    const a = controller.createTask({ title: 'a', description: '', prompt: 'run' })!
    expect(exec.runCalls).toHaveLength(1)
    controller.dispose()
    controller.moveTask(a.id, 'todo')
    expect(exec.runCalls).toHaveLength(1) // no new launch after dispose
  })
})

describe('requirement refinement', () => {
  it('launches a refine round for a backlog task, binds the refine session, and settles in place', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    seedTask(store, { status: 'backlog' })
    const { controller, stub: exec } = makeController(stub, { store })
    const taskId = 'task-a'
    expect(controller.startRefine(taskId)).toBe(true)
    // A refine round is already open: no second launch.
    expect(controller.startRefine(taskId)).toBe(false)

    const call = exec.runCalls[0]
    expect(call.taskId).toBe(taskId)
    // First round: no session yet — the runner creates and binds one.
    expect(call.options?.sessionId).toBeUndefined()
    expect(call.options?.fresh).toBe(true)
    expect(call.options?.prompt).toContain('最终执行 Prompt')

    call.fire({ kind: 'started', taskId, executionId: call.executionId, sessionId: 's-refine' })
    expect(store.load()[0].refineSessionId).toBe('s-refine')
    call.fire({ kind: 'settled', taskId, executionId: call.executionId, outcome: 'succeeded' })
    const settled = store.load()[0]
    // Refinement is preparation: the card stays in backlog.
    expect(settled.status).toBe('backlog')
    expect(settled.executions[0]).toMatchObject({ refine: true, result: 'succeeded' })
  })

  it('rejects refine for non-backlog tasks and tasks with an open run', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    seedTask(store, { status: 'todo' })
    seedTask(store, { id: 'task-b' })
    const { controller } = makeController(stub, { store })
    expect(controller.startRefine('task-a')).toBe(false)
    await controller.runTask('task-b')
    expect(controller.startRefine('task-b')).toBe(false)
  })

  it('reuses the bound refine session for answers and delivers them immediately', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    seedTask(store, { status: 'backlog' })
    const { controller, stub: exec } = makeController(stub, { store })
    const taskId = 'task-a'
    controller.startRefine(taskId)
    const first = exec.runCalls[0]
    first.fire({ kind: 'started', taskId, executionId: first.executionId, sessionId: 's-refine' })
    first.fire({ kind: 'settled', taskId, executionId: first.executionId, outcome: 'succeeded' })

    expect(controller.answerRefine(taskId, '  我选 A 方案  ')).toBe(true)
    const second = exec.runCalls[1]
    expect(second.options?.sessionId).toBe('s-refine')
    expect(second.options?.fresh).toBe(false)
    expect(second.options?.prompt).toBe('我选 A 方案')
    expect(controller.answerRefine(taskId, '   ')).toBe(false)
    // Answers never go through the comment FIFO.
    expect(exec.commentCalls).toHaveLength(0)
  })

  it('applyRefineResult writes the confirmed prompt onto the task', () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    seedTask(store, { status: 'backlog' })
    const { controller } = makeController(stub, { store })
    expect(controller.applyRefineResult('task-a', '  新的执行 Prompt  ')).toBe(true)
    expect(store.load()[0].prompt).toBe('新的执行 Prompt')
    expect(controller.applyRefineResult('task-a', '   ')).toBe(false)
  })

  it('a settled refine round never triggers a chain hand-off', async () => {
    const stub = new StubExec()
    const sessions = new FakeSessions()
    const store = new InMemoryTaskStore()
    const task = withSchedule(
      createTask({ title: 'x', description: '', prompt: 'p', status: 'backlog' }, NOW, 'task-a'),
      { enabled: true, mode: 'chain', primed: true, cron: '', maxRuns: undefined, runCount: 0 },
      NOW,
    )
    store.save([task])
    const controller = new BoardController({
      store,
      exec: stub as unknown as ExecutionService,
      sessions,
      now: () => NOW,
      uuid,
    })
    controller.start()
    expect(controller.startRefine(task.id)).toBe(true)
    const call = stub.runCalls[0]
    call.fire({ kind: 'started', taskId: task.id, executionId: call.executionId, sessionId: 's-refine' })
    call.fire({ kind: 'settled', taskId: task.id, executionId: call.executionId, outcome: 'succeeded' })
    // Only the refine round ran — no chain continuation from a refine settle.
    expect(stub.runCalls).toHaveLength(1)
  })
})

/** Controllable workspaces face for the live "链接会话" derivation tests. */
class FakeWorkspaces {
  private listeners = new Set<() => void>()
  items: Array<{ id: string; title: string; sessionIds: string[] }> = []
  archivedSessionIds: string[] = []
  list = {
    getSnapshot: (): { items: Array<{ id: string; title: string; sessionIds: string[] }>; archivedSessionIds: string[] } => ({
      items: this.items,
      archivedSessionIds: this.archivedSessionIds,
    }),
    subscribe: (fn: () => void): (() => void) => {
      this.listeners.add(fn)
      return () => { this.listeners.delete(fn) }
    },
  }
  notify(): void {
    for (const fn of [...this.listeners]) fn()
  }
}

describe('linked sessions & bind', () => {
  const workspaces = (): FakeWorkspaces => new FakeWorkspaces()

  it('createBoundTask creates a bound task, persists it, and lands in the chosen column', () => {
    const { controller, store } = makeController()
    const created = controller.createBoundTask({ kind: 'session', sessionId: 's-1' }, {
      title: '会话一', description: '', prompt: 'run', status: 'todo',
    })
    expect(created).toBeDefined()
    expect(created?.binds).toEqual([{ kind: 'session', sessionId: 's-1' }])
    expect(controller.getSnapshot().tasks[0].status).toBe('todo')
    expect(store.load()[0].binds).toEqual([{ kind: 'session', sessionId: 's-1' }])
    // Rejects a blank title like a plain create.
    expect(controller.createBoundTask({ kind: 'workspace', workspaceId: 'w-a' }, {
      title: '  ', description: '', prompt: 'run', status: 'todo',
    })).toBeUndefined()
  })

  it('createBoundTask honors any landing column (external drops stay where dropped)', () => {
    const { controller } = makeController()
    const running = controller.createBoundTask({ kind: 'session', sessionId: 's-1' }, {
      title: 'r', description: '', prompt: 'run', status: 'running',
    })!
    const review = controller.createBoundTask({ kind: 'workspace', workspaceId: 'w-a' }, {
      title: 'v', description: '', prompt: 'run', status: 'review',
    })!
    const done = controller.createBoundTask({ kind: 'session', sessionId: 's-2' }, {
      title: 'd', description: '', prompt: 'run', status: 'done',
    })!
    expect(running.status).toBe('running')
    expect(review.status).toBe('review')
    expect(done.status).toBe('done')
  })

  it('hideTaskSession / unhideTaskSessions manage a per-session hide set (persisted)', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    const run = controller.createBoundTask({ kind: 'session', sessionId: 's-1' }, {
      title: 'x', description: '', prompt: 'run', status: 'todo',
    })!
    // Hiding a session records it universally: a session that is also a run
    // session maps into the execution family by its run ids as well.
    controller.hideTaskSession(task.id, 's-1')
    controller.hideTaskSession(run.id, 's-1')
    expect(store.load()[0].hidden?.sessions).toEqual(['s-1'])
    expect(store.load()[1].hidden?.sessions).toEqual(['s-1'])
    // Restore clears the whole hidden state for a task.
    controller.unhideTaskSessions(task.id)
    expect(store.load()[0].hidden).toBeUndefined()
  })

  it('hideTaskSession also records the run ids when the session was executed', () => {
    const stub = new StubExec()
    const { controller, store } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.hideTaskSession(task.id, 's-ghost') // no runs in this session
    expect(store.load()[0].hidden).toEqual({ sessions: ['s-ghost'] })
  })

  it('unhideTaskSession restores exactly one hidden session (single-item restore)', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.hideTaskSession(task.id, 's-1')
    controller.hideTaskSession(task.id, 's-2')
    controller.hideTaskSession(task.id, 's-3')
    expect(store.load()[0].hidden?.sessions).toEqual(['s-1', 's-2', 's-3'])
    // Restore just one: the other hidden sessions stay hidden.
    controller.unhideTaskSession(task.id, 's-2')
    expect(store.load()[0].hidden?.sessions).toEqual(['s-1', 's-3'])
    // Restoring an already-visible session is a no-op (hidden stays intact).
    controller.unhideTaskSession(task.id, 's-9')
    expect(store.load()[0].hidden?.sessions).toEqual(['s-1', 's-3'])
    // Restoring the last one drops the hidden field entirely.
    controller.unhideTaskSession(task.id, 's-1')
    controller.unhideTaskSession(task.id, 's-3')
    expect(store.load()[0].hidden).toBeUndefined()
    // Unknown task: no-op.
    controller.unhideTaskSession('nope', 's-1')
  })

  it('unhideTaskSession also prunes the run ids of the restored session', async () => {
    const stub = new StubExec()
    const { controller, store } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    // Two runs settle in different sessions; hide one of them.
    await controller.runTask(task.id)
    const runA = store.load()[0].executions[0]
    stub.runCalls[0].fire({ kind: 'started', taskId: task.id, executionId: runA.id, sessionId: 's-a' })
    stub.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: runA.id, outcome: 'succeeded' })
    await controller.runTask(task.id)
    const runB = store.load()[0].executions[1]
    stub.runCalls[1].fire({ kind: 'started', taskId: task.id, executionId: runB.id, sessionId: 's-b' })
    stub.runCalls[1].fire({ kind: 'settled', taskId: task.id, executionId: runB.id, outcome: 'succeeded' })
    controller.hideTaskSession(task.id, 's-a')
    expect(store.load()[0].hidden).toEqual({ executions: [runA.id], sessions: ['s-a'] })
    // Restoring s-a prunes its run id from the hidden set; s-b is untouched.
    controller.unhideTaskSession(task.id, 's-a')
    expect(store.load()[0].hidden).toBeUndefined()
    expect(store.load()[0].executions.map(run => run.id)).toEqual([runA.id, runB.id])
  })

  it('addTaskSource ADDS a source onto an existing task (same source idempotent), persists', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    // A plain task gains a live binding.
    expect(controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })).toBe(true)
    expect(store.load()[0].binds).toEqual([{ kind: 'session', sessionId: 's-1' }])
    // Dragging the SAME source again is an idempotent no-op — never a replace.
    expect(controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })).toBe(false)
    expect(store.load()[0].binds).toHaveLength(1)
    // A different source JOINS the multi-source set (drag-in = add).
    expect(controller.addTaskSource(task.id, { kind: 'workspace', workspaceId: 'w-a' })).toBe(true)
    expect(store.load()[0].binds).toEqual([
      { kind: 'session', sessionId: 's-1' },
      { kind: 'workspace', workspaceId: 'w-a' },
    ])
    // Unknown task: rejected.
    expect(controller.addTaskSource('nope', { kind: 'session', sessionId: 's-1' })).toBe(false)
  })

  it('a folder bound onto an existing task syncs newly opened sessions live (regression)', () => {
    const wss = workspaces()
    wss.items = [{ id: 'w-a', title: '项目A', sessionIds: ['s-1'] }]
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = false
    const controller = new BoardController({
      store: new InMemoryTaskStore(),
      exec: new StubExec() as unknown as ExecutionService,
      sessions,
      workspaces: wss,
      now: () => NOW,
      uuid,
    })
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.addTaskSource(task.id, { kind: 'workspace', workspaceId: 'w-a' })
    // The added source is persisted through the ledger.
    const bound = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.sessionsOf(bound).map(row => row.sessionId)).toEqual(['s-1'])
    // A session opens inside the folder later: the board picks it up with no
    // manual "sync" step (the earlier sessionsOf snapshot is already stale).
    wss.items = [{ id: 'w-a', title: '项目A', sessionIds: ['s-1', 's-2'] }]
    sessions.runningById['s-2'] = false
    wss.notify()
    expect(controller.sessionsOf(bound).map(row => row.sessionId)).toEqual(['s-1', 's-2'])
  })

  it('copyTask clones content, run config and the automation rule (runCount reset)', () => {
    const stub = new StubExec()
    const { controller } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: 'd', prompt: 'p', status: 'todo' })!
    controller.setSchedule(task.id, { enabled: true, mode: 'chain', maxRuns: 3 })
    const copy = controller.copyTask(task.id)
    expect(copy).toBeDefined()
    expect(copy!.id).not.toBe(task.id)
    expect(copy!.title).toBe('x')
    expect(copy!.prompt).toBe('p')
    expect(copy!.status).toBe('backlog')
    expect(copy!.executions).toHaveLength(0)
    expect(copy!.bind).toBeUndefined()
    expect(copy!.schedule).toMatchObject({ enabled: true, mode: 'chain', maxRuns: 3, runCount: 0 })
    // The source task is untouched; the board now holds both.
    expect(controller.getSnapshot().tasks).toHaveLength(2)
    // A template lands at the TOP of its landing column (待规划) exactly like
    // a manually created task — never appended to the bottom.
    expect(copy!.status).toBe('backlog')
    expect(copy!.order).toBe(0)
    const backlogCards = controller.getSnapshot().tasks
      .filter(task => task.status === 'backlog')
      .sort((a, b) => a.order - b.order)
    expect(backlogCards[0].id).toBe(copy!.id)
  })

  it('copyTask carries accent color and session rules as part of the template', () => {
    const stub = new StubExec()
    const { controller } = makeController(stub)
    const source = controller.createTask({ title: '源', description: '', prompt: 'run' })!
    controller.setTaskColor(source.id, '#4f46e5')
    controller.createSessionRule(source.id, { sessionId: 's-1', instruction: '继续', cron: '0 * * * *', send: 'steer' })
    const current = controller.getSnapshot().tasks.find(task => task.id === source.id)
    const copy = controller.copyTask(source.id)
    expect(copy).toBeDefined()
    expect(copy!.color).toBe('#4f46e5')
    // Session rules are cloned with fresh ids (never shared state).
    expect(copy!.rules).toHaveLength(1)
    expect(copy!.rules![0].instruction).toBe('继续')
    expect(copy!.rules![0].id).not.toBe(current!.rules![0].id)
  })

  it('cruise windows: setCruiseSchedule recomputes effective state; tickCruise flips at boundaries', () => {
    const stub = new StubExec()
    const { controller } = makeController(stub, { now: () => NOW })
    // A future window: still off now, the heartbeat flips it on at its start.
    controller.setCruiseSchedule([{ startAt: NOW + 1000 }])
    expect(controller.getSnapshot().cruise.enabled).toBe(false)
    controller.tickCruise(NOW + 2000)
    expect(controller.getSnapshot().cruise.enabled).toBe(true)
    // A window covering now enables immediately; removing it flips off.
    controller.setCruiseSchedule([{ startAt: NOW - 1000 }])
    expect(controller.getSnapshot().cruise.enabled).toBe(true)
    controller.setCruiseSchedule([])
    expect(controller.getSnapshot().cruise.enabled).toBe(false)
  })

  it('sendSessionMessage records a direct round into the session thread (read-only, never drives)', async () => {
    const stub = new StubExec()
    const { controller, store } = makeController(stub, {
      sessionMessage: async () => ({ ok: true as const }),
    })
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    await controller.sendSessionMessage(task.id, 's-1', ' 直发一句 ')
    const round = store.load()[0].executions[0]
    expect(round).toMatchObject({ sessionId: 's-1', comment: '直发一句', direct: true, result: 'succeeded' })
    expect(round.injectedAt).toBeUndefined()
    expect(round.endedAt).toBeDefined()
    // Not driven: nothing launched, task state untouched, appears in the thread.
    expect(stub.runCalls).toHaveLength(0)
    expect(store.load()[0].status).toBe('todo')
    expect(sessionCommentsOf(store.load()[0], 's-1', true).map(view => view.round.id)).toEqual([round.id])
    // A failed send records nothing.
    const { controller: c2, store: s2 } = makeController(stub, {
      sessionMessage: async () => ({ ok: false as const, error: 'boom' }),
    })
    const t2 = c2.createTask({ title: 'y', description: '', prompt: 'run' })!
    await c2.sendSessionMessage(t2.id, 's-2', '失败句')
    expect(s2.load()[0].executions).toHaveLength(0)
  })

  it('boundSourceTitleOf resolves from the native snapshots', () => {
    const wss = workspaces()
    wss.items = [{ id: 'w-a', title: '项目A', sessionIds: ['s-1'] }, { id: 'w-b', title: '其他', sessionIds: [] }]
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = false
    const controller = new BoardController({
      store: new InMemoryTaskStore(),
      exec: new StubExec() as unknown as ExecutionService,
      sessions,
      workspaces: wss,
      now: () => NOW,
      uuid,
    })
    expect(controller.boundSourceTitleOf({ kind: 'workspace', workspaceId: 'w-a' })).toBe('项目A')
    expect(controller.boundSourceTitleOf({ kind: 'workspace', workspaceId: 'gone' })).toBe('gone')
    expect(controller.boundSourceTitleOf({ kind: 'session', sessionId: 's-1' })).toBe('s-1')
  })

  it('removeTaskSession removes the session records, clears its hide state and unbinds a sole session source', () => {
    const { controller, store } = makeController()
    const task = controller.createBoundTask({ kind: 'session', sessionId: 's-1' }, { title: 't', description: '', prompt: 'run' })!
    controller.hideTaskSession(task.id, 's-1')
    // The task has no rounds for the session, but it IS hidden — removal
    // clears the hide state + unbinds the sole session source.
    expect(controller.removeTaskSession(task.id, 's-1')).toBe(true)
    const after = store.load()[0]
    expect(after.hidden).toBeUndefined()
    expect(after.bind).toBeUndefined()
    expect(after.binds).toBeUndefined()
  })

  it('removeTaskSession removes that session rounds while keeping every other session and the task', () => {
    const stub = new StubExec()
    const { controller } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.submitSessionComment(task.id, 's-1', '给 s-1 的评论')
    controller.submitSessionComment(task.id, 's-2', '给 s-2 的评论')
    expect(controller.removeTaskSession(task.id, 's-1')).toBe(true)
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.executions.filter(round => round.sessionId === 's-1')).toHaveLength(0)
    expect(row.executions.some(round => round.sessionId === 's-2')).toBe(true)
    // Removing an unknown session is a no-op.
    expect(controller.removeTaskSession(task.id, 's-none')).toBe(false)
  })

  it('externalKindOf classifies sidebar ids and linkedOf derives workspace rows live', () => {
    const wss = workspaces()
    wss.items = [{ id: 'w-a', title: '项目A', sessionIds: ['s-1', 's-2'] }]
    wss.archivedSessionIds = ['s-2']
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = true
    const controller = new BoardController({
      store: new InMemoryTaskStore(),
      exec: new StubExec() as unknown as ExecutionService,
      sessions,
      workspaces: wss,
      now: () => NOW,
      uuid,
    })
    expect(controller.externalKindOf('w-a')).toBe('workspace')
    expect(controller.externalKindOf('s-1')).toBe('session')
    const task: TaskRecord = taskWithBind({ kind: 'workspace', workspaceId: 'w-a' })
    const rows = controller.linkedOf(task)
    expect(rows.map(row => row.sessionId)).toEqual(['s-1'])
    // A snapshot change surfaces live (new session added, not archived).
    wss.items = [{ id: 'w-a', title: '项目A', sessionIds: ['s-1', 's-2', 's-3'] }]
    sessions.runningById['s-3'] = false
    wss.notify()
    expect(controller.linkedOf(task).map(row => row.sessionId)).toEqual(['s-1', 's-3'])
  })

  it('removeTaskSession keeps a workspace-bound session removed permanently (no resurrection)', () => {
    const wss = workspaces()
    wss.items = [{ id: 'w-a', title: '项目A', sessionIds: ['s-1', 's-2'] }]
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = false
    sessions.runningById['s-2'] = false
    const controller = new BoardController({
      store: new InMemoryTaskStore(),
      exec: new StubExec() as unknown as ExecutionService,
      sessions,
      workspaces: wss,
      now: () => NOW,
      uuid,
    })
    const task = controller.createBoundTask({ kind: 'workspace', workspaceId: 'w-a' }, { title: 't', description: '', prompt: '' })!
    // A manual order is in effect before the removal: dropping s-2 BEFORE s-1
    // persists ['s-2', 's-1'] — the removal must also strip its slot.
    expect(controller.reorderTaskSession(task.id, 's-2', 's-1')).toBe(true)
    controller.hideTaskSession(task.id, 's-1')
    let current = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.sessionsOf(current).map(row => row.sessionId)).toEqual(['s-2'])
    expect(controller.removeTaskSession(task.id, 's-1')).toBe(true)
    // The workspace still contains s-1, but the removal is permanent: it never
    // re-derives, neither in the list nor in linkedOf.
    current = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.sessionsOf(current).map(row => row.sessionId)).toEqual(['s-2'])
    expect(controller.linkedOf(current).map(row => row.sessionId)).toEqual(['s-2'])
    expect(current.removedSessions).toContain('s-1')
    expect(current.hidden).toBeUndefined()
    // The removed session's manual-order slot is gone with it; only s-2's
    // remains. Removing the last ordered session clears the field entirely.
    expect(current.sessionsOrder).toEqual(['s-2'])
    controller.hideTaskSession(task.id, 's-2')
    expect(controller.removeTaskSession(task.id, 's-2')).toBe(true)
    current = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(current.sessionsOrder).toBeUndefined()
  })

  it('reorderTaskSession persists the manual 会话 order (drop into a slot)', () => {
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = false
    const wss = workspaces()
    wss.items = [{ id: 'w-x', title: 'W', sessionIds: [] }]
    const controller = new BoardController({
      store: new InMemoryTaskStore(),
      exec: new StubExec() as unknown as ExecutionService,
      sessions,
      workspaces: wss,
      now: () => NOW,
      uuid,
    })
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })
    sessions.runningById['s-2'] = false
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-2' })
    const before = controller.sessionsOf(controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!)
      .map(row => row.sessionId)
    expect(before).toContain('s-1')
    // Drag s-1 to the END (beforeId undefined) — the persisted order equals
    // the new display order.
    expect(controller.reorderTaskSession(task.id, 's-1', undefined)).toBe(true)
    const after = controller.sessionsOf(controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!)
      .map(row => row.sessionId)
    expect(after).toEqual([...before.filter(id => id !== 's-1'), 's-1'])
    const persisted = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(persisted.sessionsOrder).toEqual(after)
    // The same order on a second drag is a no-op.
    expect(controller.reorderTaskSession(task.id, 's-1', undefined)).toBe(false)
  })

  it('addTaskSource restores a removed session when the session itself is re-dragged (explicit bring-back)', () => {
    const wss = workspaces()
    wss.items = [{ id: 'w-a', title: '项目A', sessionIds: ['s-1', 's-2'] }]
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = false
    sessions.runningById['s-2'] = false
    const controller = new BoardController({
      store: new InMemoryTaskStore(),
      exec: new StubExec() as unknown as ExecutionService,
      sessions,
      workspaces: wss,
      now: () => NOW,
      uuid,
    })
    const task = controller.createBoundTask({ kind: 'workspace', workspaceId: 'w-a' }, { title: 't', description: '', prompt: '' })!
    controller.hideTaskSession(task.id, 's-1')
    expect(controller.removeTaskSession(task.id, 's-1')).toBe(true)
    let current = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.sessionsOf(current).map(row => row.sessionId)).toEqual(['s-2'])
    // Removal stays passive-immune (no resurrection), but the USER dragging
    // the session back is the restore gesture: it shows again.
    expect(controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })).toBe(true)
    current = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.sessionsOf(current).map(row => row.sessionId)).toContain('s-1')
    expect(current.removedSessions ?? []).not.toContain('s-1')
  })

  it('addTaskSource restores the workspace\'s removed members when the folder itself is re-dragged (same-source re-add)', () => {
    const wss = workspaces()
    wss.items = [{ id: 'w-a', title: '项目A', sessionIds: ['s-1', 's-2'] }]
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = false
    sessions.runningById['s-2'] = false
    const controller = new BoardController({
      store: new InMemoryTaskStore(),
      exec: new StubExec() as unknown as ExecutionService,
      sessions,
      workspaces: wss,
      now: () => NOW,
      uuid,
    })
    const task = controller.createBoundTask({ kind: 'workspace', workspaceId: 'w-a' }, { title: 't', description: '', prompt: '' })!
    controller.hideTaskSession(task.id, 's-1')
    expect(controller.removeTaskSession(task.id, 's-1')).toBe(true)
    // Re-dragging the SAME folder (an identical bind) is not a no-op when the
    // folder carries removed members: the restore gesture clears them.
    expect(controller.addTaskSource(task.id, { kind: 'workspace', workspaceId: 'w-a' })).toBe(true)
    const current = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.sessionsOf(current).map(row => row.sessionId)).toContain('s-1')
    expect(current.removedSessions).toBeUndefined()
  })
})

describe('sendSessionMessage (direct linked-session messages)', () => {
  it('sends plain text through the sessionMessage face and reports ok', async () => {
    const sent: string[] = []
    const { controller } = makeController(new StubExec(), {
      sessionMessage: async (sessionId, text) => {
        sent.push(`${sessionId}:${text}`)
        return { ok: true as const }
      },
    })
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    expect(controller.directMessageAvailable()).toBe(true)
    await expect(controller.sendSessionMessage(task.id, 's-1', '  继续   ')).resolves.toEqual({ ok: true })
    expect(sent).toEqual(['s-1:继续'])
  })

  it('revives a completed task when a steer is sent to its session', async () => {
    const stub = new StubExec()
    const { controller, store } = makeController(stub, {
      sessionMessage: async () => ({ ok: true as const }),
    })
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.moveTask(task.id, 'done')
    expect(store.load()[0].status).toBe('done')
    // Steer on a done task = the same revive rule as queued comments.
    await expect(controller.steerComment(task.id, 's-1', '直接说')).resolves.toEqual({ ok: true })
    expect(store.load()[0].status).toBe('todo')
  })

  it('blocks every drive path when the execution prompt is empty (nothing can run)', async () => {
    const stub = new StubExec()
    const { controller, store } = makeController(stub, {
      sessionMessage: async () => ({ ok: true as const }),
    })
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    // A blank prompt never launches: manual, quick-run, re-run, chain/schedule/
    // cruise all funnel through runTask — one door, one gate.
    await expect(controller.runTask(task.id)).resolves.toBe(false)
    await controller.rerunTask(task.id)
    expect(store.load()[0].executions).toHaveLength(0)
    expect(store.load()[0].status).toBe('todo')
    // Comments (queue) and steer (direct) are gated too — with the same
    // reason, not a silent no-op.
    expect(controller.submitSessionComment(task.id, 'linked-7', '别驱动')).toBeUndefined()
    await expect(controller.steerComment(task.id, 'linked-7', '也别直接发')).resolves.toEqual({ ok: false, error: 'empty prompt' })
    expect(store.load()[0].executions).toHaveLength(0)
    // Filling the prompt restores every path.
    controller.updateTask(task.id, { prompt: '真实内容' })
    expect(store.load()[0].prompt).toBe('真实内容')
    await expect(controller.runTask(task.id)).resolves.toBe(true)
    expect(store.load()[0].status).toBe('running')
  })

  it('routes a leading slash through the command registry; unmatched falls back to plain text', async () => {
    const sent: string[] = []
    const { controller } = makeController(new StubExec(), {
      sessionMessage: async (sessionId, text) => {
        sent.push(`text:${sessionId}:${text}`)
        return { ok: true as const }
      },
      sessionCommand: async (_sessionId, line) => {
        sent.push(`command:${line}`)
        return line === '/plan ok'
          ? { ok: true as const, matched: true, outcome: { kind: 'success' as const, text: 'planned' } }
          : { ok: true as const, matched: false }
      },
    })
    // Matched command: executed, never sent as text.
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    await expect(controller.sendSessionMessage(task.id, 's-1', '/plan ok')).resolves.toEqual({ ok: true })
    // Unknown command: the native default-sink delivers the line as text.
    await expect(controller.sendSessionMessage(task.id, 's-1', '/nope x')).resolves.toEqual({ ok: true })
    expect(sent).toEqual(['command:/plan ok', 'command:/nope x', 'text:s-1:/nope x'])
  })

  it('surfaces face errors without throwing', async () => {
    const { controller } = makeController(new StubExec(), {
      sessionMessage: async () => ({ ok: false as const, error: 'session gone' }),
      sessionCommand: async () => ({ ok: false as const, error: 'command rejected' }),
    })
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    await expect(controller.sendSessionMessage(task.id, 's-1', 'hi')).resolves.toEqual({ ok: false, error: 'session gone' })
    await expect(controller.sendSessionMessage(task.id, 's-1', '/perm read-only')).resolves.toEqual({ ok: false, error: 'command rejected' })
  })

  it('degrades gracefully when the direct faces are absent', async () => {
    const { controller } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    expect(controller.directMessageAvailable()).toBe(false)
    await expect(controller.sendSessionMessage(task.id, 's-1', 'hi')).resolves.toEqual({ ok: false, error: 'direct message unavailable' })
    // Without a command face, a slash line degrades to the text path — which
    // is also absent here, so it reports unavailable (never throws).
    await expect(controller.sendSessionMessage(task.id, 's-1', '/x')).resolves.toEqual({ ok: false, error: 'direct message unavailable' })
  })

  it('rejects blank messages without calling any face', async () => {
    let called = false
    const { controller } = makeController(new StubExec(), {
      sessionMessage: async () => { called = true; return { ok: true as const } },
    })
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    await expect(controller.sendSessionMessage(task.id, 's-1', '   ')).resolves.toEqual({ ok: false, error: 'empty message' })
    expect(called).toBe(false)
  })
})

describe('native-activity sync (两端同步)', () => {
  /** A controller over a persisted task that has run on session s-1. */
  function harness(extra: Partial<ControllerDeps> = {}) {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const seeded = createTask({ title: 'x', description: '', prompt: 'run' }, NOW, 'task-a')
    store.save([{ ...seeded, status: 'review', executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: NOW + 1, result: 'failed', error: undefined }] }])
    const sessions = new FakeSessions()
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0, ...extra,
    })
    controller.start()
    return { controller, sessions, store, stub }
  }

  it('an out-of-band native turn drives review → running → review and threads the round', async () => {
    const { controller, sessions, stub } = harness()
    await flush()
    sessions.setRunning('s-1', false) // baseline
    await flush()
    sessions.setRunning('s-1', true) // the user chats in the native UI
    await flush()
    await flush()
    const running = controller.getSnapshot().tasks[0]
    expect(running.status).toBe('running')
    const external = running.executions[running.executions.length - 1]
    expect(external.external).toBe(true)
    expect(external.sessionId).toBe('s-1')
    expect(external.endedAt).toBeUndefined()

    // The native turn finishes with real evidence → the card settles to review.
    const extId = external.id
    stub.reconcileResult = { kind: 'settled', taskId: 'task-a', executionId: extId, outcome: 'succeeded' }
    sessions.setRunning('s-1', false)
    await flush()
    await flush()
    const settled = controller.getSnapshot().tasks[0]
    expect(settled.status).toBe('review')
    const round = settled.executions.find(run => run.id === extId)
    expect(round?.endedAt).not.toBeUndefined()
    expect(round?.result).toBe('succeeded')
  })

  it('past activity never re-fires on the initial baseline', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const seeded = createTask({ title: 'x', description: '', prompt: 'run' }, NOW, 'task-a')
    store.save([{ ...seeded, status: 'review', executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: NOW + 1, result: 'failed', error: undefined }] }])
    const sessions = new FakeSessions()
    // The native session is ALREADY running before the board's first scan —
    // the controller must baseline it, never record past activity.
    sessions.setRunning('s-1', true)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    const task = controller.getSnapshot().tasks[0]
    expect(task.executions.some(run => run.external === true)).toBe(false)
    expect(task.status).toBe('review')
  })

  it('a board direct-send does not double-record its turn as an external round', async () => {
    const { controller, sessions } = harness({
      sessionMessage: async (): Promise<{ ok: true }> => ({ ok: true as const }),
    })
    await flush()
    sessions.setRunning('s-1', false) // baseline
    await flush()
    await controller.sendSessionMessage('task-a', 's-1', 'hello')
    await flush()
    const withDirect = controller.getSnapshot().tasks[0]
    expect(withDirect.executions.some(run => run.direct === true)).toBe(true)
    // The native turn it started must not ALSO become an external round.
    sessions.setRunning('s-1', true)
    await flush()
    await flush()
    const after = controller.getSnapshot().tasks[0]
    expect(after.executions.some(run => run.external === true)).toBe(false)
    expect(after.executions.filter(run => run.direct === true).length).toBe(1)
  })

  it('a spurious running flip with no evidence is cancelled after the grace', async () => {
    let clock = NOW
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const seeded = createTask({ title: 'x', description: '', prompt: 'run' }, NOW, 'task-a')
    store.save([{ ...seeded, status: 'review', executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: NOW + 1, result: 'failed', error: undefined }] }])
    const sessions = new FakeSessions()
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => clock, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    sessions.setRunning('s-1', false)
    await flush()
    sessions.setRunning('s-1', true)
    await flush()
    await flush()
    const running = controller.getSnapshot().tasks[0]
    expect(running.status).toBe('running')
    const extId = running.executions[running.executions.length - 1].id
    // Session ends with NO turn evidence; still inside the grace → stays running.
    stub.reconcileResult = undefined
    sessions.setRunning('s-1', false)
    await flush()
    await flush()
    expect(controller.getSnapshot().tasks[0].status).toBe('running')
    // Past the grace → the spurious round is cancelled (card back to todo).
    clock = NOW + 100_000
    sessions.setRunning('s-1', false)
    await flush()
    await flush()
    const cancelled = controller.getSnapshot().tasks[0]
    expect(cancelled.status).toBe('todo')
    expect(cancelled.executions.find(run => run.id === extId)?.result).toBe('cancelled')
  })

  it('an out-of-band refine turn keeps the column and marks refining', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const seeded = createTask({ title: 'r', description: '', prompt: 'run' }, NOW, 'task-r')
    store.save([{ ...seeded, status: 'backlog', refineSessionId: 's-r' }])
    const sessions = new FakeSessions()
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    sessions.setRunning('s-r', false)
    await flush()
    sessions.setRunning('s-r', true)
    await flush()
    await flush()
    const task = controller.getSnapshot().tasks[0]
    expect(task.status).toBe('backlog')
    expect(task.executions.some(run => run.refine === true && run.external === true && run.endedAt === undefined)).toBe(true)
  })
})

describe('card accent color', () => {
  it('setTaskColor sets/clears on the card', () => {
    const { controller } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setTaskColor(task.id, '#12a594')
    let row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.color).toBe('#12a594')
    controller.setTaskColor(task.id, undefined)
    row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.color).toBeUndefined()
  })
})

describe('bound-session instant sync (拖入瞬间全同步)', () => {
  it('dragging in a RUNNING session instantly marks the card running + external round + unviewed + threaded', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const sessions = new FakeSessions()
    sessions.setRunning('s-live', true) // the user is mid-conversation right now
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    const task = controller.createBoundTask(
      { kind: 'session', sessionId: 's-live' },
      { title: 'live', description: '', prompt: 'run' },
    )!
    await flush() // the bind sync captures the running turn (async transcript read)
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.status).toBe('running')
    const ext = row.executions[row.executions.length - 1]
    expect(ext.external).toBe(true)
    expect(ext.sessionId).toBe('s-live')
    expect(ext.endedAt).toBeUndefined()
    // Brand-new content the user has not seen: the card breathes unviewed.
    expect(taskUnviewed(row)).toBe(true)
    // The running turn appears in the session comment thread immediately.
    expect(sessionCommentsOf(row, 's-live', true).map(view => view.round.id)).toContain(ext.id)
  })

  it('a bound session that is idle stays at its landing column (no fabricated round)', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const sessions = new FakeSessions()
    sessions.setRunning('s-idle', false)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    const task = controller.createBoundTask(
      { kind: 'session', sessionId: 's-idle' },
      { title: 'idle', description: '', prompt: 'run', status: 'todo' },
    )!
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.status).toBe('todo')
    expect(row.executions.length).toBe(0)
  })

  it('binding to a running session syncs instantly; adding the same source is idempotent', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const sessions = new FakeSessions()
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    sessions.setRunning('s-live', true)
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-live' })
    await flush() // the add-sync is async (transcript read)
    let row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.status).toBe('running')
    expect(row.executions.filter(round => round.external === true).length).toBe(1)
    // Adding the same live source again must not double-record.
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-live' })
    await flush()
    row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.executions.filter(round => round.external === true).length).toBe(1)
  })

  it('a bound RUNNING session settles to 待审核 when the native turn finishes', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const sessions = new FakeSessions()
    sessions.setRunning('s-live', true)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    const task = controller.createBoundTask({ kind: 'session', sessionId: 's-live' }, { title: 'live', description: '', prompt: 'run' })!
    await flush() // the bind sync appends the external round asynchronously
    const extId = controller.getSnapshot().tasks[0].executions[0].id
    stub.reconcileResult = { kind: 'settled', taskId: task.id, executionId: extId, outcome: 'succeeded' }
    sessions.setRunning('s-live', false)
    await flush()
    await flush()
    expect(controller.getSnapshot().tasks[0].status).toBe('review')
  })
})

describe('session automation rules (给会话定时发指令)', () => {
  function ruleHarness(sessionIds: string[], faces: {
    sessionMessage?: (sessionId: string, text: string) => Promise<{ ok: true } | { ok: false; error: string }>
    sessionCommand?: (sessionId: string, line: string) => Promise<{ ok: true; matched: boolean } | { ok: false; error: string }>
  }) {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const sessions = new FakeSessions()
    for (const id of sessionIds) sessions.setRunning(id, false)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions,
      now: () => NOW,
      uuid,
      reconcileDebounceMs: 0,
      ...faces,
    })
    controller.start()
    return { controller, sessions }
  }

  it('creates a rule with a due instant and rejects an unparseable cron', () => {
    const { controller } = ruleHarness(['s-a'], {})
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    const rule = controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'nightly check', cron: '0 0 * * *', send: 'queue' })
    expect(rule).toBeDefined()
    expect(rule!.nextAt).toBeGreaterThan(NOW)
    expect(controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'x', cron: 'not a cron', send: 'queue' })).toBeUndefined()
  })

  it('fires a due steer rule: sends the instruction, records a direct round, rolls forward', async () => {
    const sent: Array<[string, string]> = []
    const { controller } = ruleHarness(['s-a'], { sessionMessage: async (sessionId, text) => { sent.push([sessionId, text]); return { ok: true as const } } })
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'hello', cron: '* * * * *', send: 'steer' })!
    await controller.tickSessionRules(NOW + 120_000)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(['s-a', 'hello'])
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.executions.some(round => round.direct === true && round.comment === 'hello')).toBe(true)
    expect(row.rules?.[0].lastAt).toBe(NOW + 120_000)
    expect(row.rules?.[0].nextAt).toBeGreaterThan(NOW + 120_000 - 60_000)
    // Rolled forward to the next cron match: a tick before that instant does
    // not re-fire; the minute rule fires again at the new boundary.
    const rolled = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!.rules![0].nextAt
    await controller.tickSessionRules(rolled - 1000)
    expect(sent).toHaveLength(1)
    await controller.tickSessionRules(rolled + 1000)
    expect(sent).toHaveLength(2)
  })

  it('a queue-mode rule queues a comment round for the dispatcher (nothing direct)', async () => {
    const sent: Array<[string, string]> = []
    const { controller } = ruleHarness(['s-a'], { sessionMessage: async (sessionId, text) => { sent.push([sessionId, text]); return { ok: true as const } } })
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'hello', cron: '* * * * *', send: 'queue' })!
    await controller.tickSessionRules(NOW + 120_000)
    expect(sent).toHaveLength(0) // never sent directly
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    const queued = row.executions.find(round => round.comment === 'hello')
    expect(queued?.comment).toBe('hello')
    expect(queued?.direct).toBeUndefined()
    expect(queued?.injectedAt).toBeUndefined() // awaiting the dispatcher
    expect(row.rules?.[0].lastAt).toBe(NOW + 120_000)
    expect(row.rules?.[0].nextAt).toBeGreaterThan(NOW + 120_000 - 60_000)
  })

  it('a disabled rule never fires; a rule whose session is gone keeps its slot', async () => {
    const sent: Array<[string, string]> = []
    const { controller } = ruleHarness(['s-a', 's-b'], { sessionMessage: async (sessionId, text) => { sent.push([sessionId, text]); return { ok: true as const } } })
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    const off = controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'a', cron: '* * * * *', send: 'queue' })!
    const gone = controller.createSessionRule(task.id, { sessionId: 's-gone', instruction: 'b', cron: '* * * * *', send: 'queue' })!
    controller.toggleSessionRule(task.id, off.id, false)
    await controller.tickSessionRules(NOW + 120_000)
    expect(sent).toHaveLength(0) // disabled + missing-session both skipped
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.rules?.find(r => r.id === gone.id)?.nextAt).toBe(gone.nextAt)
  })

  it('slash instructions route through the command registry (steer)', async () => {
    const lines: string[] = []
    const { controller } = ruleHarness(['s-a'], {
      sessionCommand: async (_sessionId, line) => { lines.push(line); return { ok: true as const, matched: true } },
    })
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    controller.createSessionRule(task.id, { sessionId: 's-a', instruction: '/goal', cron: '* * * * *', send: 'steer' })
    await controller.tickSessionRules(NOW + 120_000)
    expect(lines).toEqual(['/goal'])
  })

  it('updateSessionRule edits in place: cron change recomputes the due slot, invalid patches are rejected', () => {
    const { controller } = ruleHarness(['s-a'], {})
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    const rule = controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'hello', cron: '0 0 * * *', send: 'queue' })!
    // Non-cron fields change without touching the due slot.
    const before = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!.rules![0]
    expect(controller.updateSessionRule(task.id, rule.id, { instruction: 'nightly check', send: 'steer' })).toBe(true)
    const after = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!.rules![0]
    expect(after.instruction).toBe('nightly check')
    expect(after.send).toBe('steer')
    expect(after.nextAt).toBe(before.nextAt)
    // A cron change recomputes the due instant from now.
    expect(controller.updateSessionRule(task.id, rule.id, { cron: '0 12 * * *' })).toBe(true)
    const changed = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!.rules![0]
    expect(changed.cron).toBe('0 12 * * *')
    expect(changed.nextAt).not.toBe(before.nextAt)
    expect(changed.nextAt).toBeGreaterThan(NOW)
    // Invalid patches leave the rule untouched.
    expect(controller.updateSessionRule(task.id, rule.id, { cron: 'not a cron' })).toBe(false)
    expect(controller.updateSessionRule(task.id, rule.id, { instruction: '' })).toBe(false)
    const intact = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!.rules![0]
    expect(intact.cron).toBe('0 12 * * *')
    expect(intact.instruction).toBe('nightly check')
  })

  it('a rule on a non-drivable column stays paused: never fires, keeps its slot', async () => {
    const sent: Array<[string, string]> = []
    const { controller } = ruleHarness(['s-a'], { sessionMessage: async (sessionId, text) => { sent.push([sessionId, text]); return { ok: true as const } } })
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    const rule = controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'hello', cron: '* * * * *', send: 'steer' })!
    controller.moveTask(task.id, 'done')
    await controller.tickSessionRules(NOW + 120_000)
    expect(sent).toHaveLength(0) // paused on done: the due slot is a hold, never a retry storm
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.rules![0].enabled).toBe(true)
    expect(row.rules![0].nextAt).toBe(rule.nextAt)
    expect(row.rules![0].lastAt).toBeUndefined()
    // Moving the task back to a drivable column resumes the rule.
    controller.moveTask(task.id, 'todo')
    await controller.tickSessionRules(NOW + 120_000)
    expect(sent).toEqual([['s-a', 'hello']])
  })

  it('the task-level schedule and session rules are INDEPENDENT: turning the task schedule off never pauses session rules', async () => {
    const sent: Array<[string, string]> = []
    const { controller } = ruleHarness(['s-a'], { sessionMessage: async (sessionId, text) => { sent.push([sessionId, text]); return { ok: true as const } } })
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    // Arm BOTH halves, then disarm ONLY the task-level schedule.
    controller.setSchedule(task.id, { enabled: true, mode: 'cron', cron: '* * * * *' })
    controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'hello', cron: '* * * * *', send: 'steer' })!
    controller.setSchedule(task.id, { enabled: false })
    await controller.tickSessionRules(NOW + 120_000)
    expect(sent).toEqual([['s-a', 'hello']]) // the session rule still fired
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.schedule?.enabled).toBe(false)
    expect(row.rules?.some(rule => rule.lastAt !== undefined)).toBe(true)
  })

  it('with only a session rule (no task schedule) the task-level automation stays off', async () => {
    const sent: Array<[string, string]> = []
    const { controller } = ruleHarness(['s-a'], { sessionMessage: async (sessionId, text) => { sent.push([sessionId, text]); return { ok: true as const } } })
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'hello', cron: '* * * * *', send: 'steer' })!
    // The rule fires without ever touching the task-level half.
    await controller.tickSessionRules(NOW + 120_000)
    expect(sent).toEqual([['s-a', 'hello']])
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.schedule).toBeUndefined() // the task schedule was never created
    expect(ruleReadiness(row).kind).toBe('disabled') // task-level automation: off
  })
})

/** Build a task with a bind (test helper). */
function taskWithBind(bind: NonNullable<TaskRecord['bind']>): TaskRecord {
  return { id: 'task-b', title: 'T', description: '', prompt: 'run', status: 'todo', order: 0, createdAt: 0, updatedAt: 0, executions: [], bind }
}
