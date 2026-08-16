/**
 * Controller tests: orchestration — persistence, view state, navigation
 * awareness, and the full run loop (running → started(sessionId) → settled).
 */
import { describe, expect, it, vi } from 'vitest'
import { BoardController, type ControllerDeps } from '../src/core/controller.ts'
import { ExecutionService, type ExecutionEvent } from '../src/core/execution.ts'
import { InMemoryTaskStore } from '../src/core/store.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'

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
  private listeners = new Set<() => void>()
  list = {
    getSnapshot: (): { current: string | undefined; byId: Record<string, { running: boolean }> } => ({
      current: this.current,
      byId: Object.fromEntries(
        Object.entries(this.runningById).map(([id, running]) => [id, { running }]),
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
}

/** Controllable ExecutionService stub: captures run calls, fires events on demand. */
class StubExec {
  runCalls: Array<{ task: TaskRecord; taskId: string; executionId: string; fire: (event: ExecutionEvent) => void }> = []
  commentCalls: Array<{ taskId: string; executionId: string; sessionId: string; text: string; fire: (event: ExecutionEvent) => void }> = []
  reconcileResult: ExecutionEvent | undefined = undefined
  async run(task: TaskRecord, execution: { id: string }, onEvent: (event: ExecutionEvent) => void): Promise<void> {
    this.runCalls.push({ task, taskId: task.id, executionId: execution.id, fire: onEvent })
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
    const { controller, store } = makeController()
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
    const task = controller.createTask({ title: ' 新任务 ', description: '', prompt: '' })
    expect(task).toBeDefined()
    expect(controller.getSnapshot().tasks).toHaveLength(1)
    expect(store.load()[0].title).toBe('新任务')
    expect(controller.createTask({ title: '   ', description: '', prompt: '' })).toBeUndefined()
  })

  it('deletes and clears the selection when the selected task is removed', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    controller.openTask(task.id)
    controller.deleteTask(task.id)
    expect(controller.getSnapshot().tasks).toHaveLength(0)
    expect(controller.getSnapshot().selectedTaskId).toBeUndefined()
    expect(store.load()).toEqual([])
  })

  it('updates and moves tasks with persistence', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    controller.updateTask(task.id, { title: 'y' })
    controller.moveTask(task.id, 'backlog')
    const persisted = store.load()[0]
    expect(persisted.title).toBe('y')
    expect(persisted.status).toBe('backlog')
  })

  it('creates into the chosen landing column with a fresh sort key', () => {
    const { controller, store } = makeController()
    const todo = controller.createTask({ title: 'a', description: '', prompt: '' })!
    const backlog = controller.createTask({ title: 'b', description: '', prompt: '', status: 'backlog' })!
    expect(todo.status).toBe('todo')
    expect(backlog.status).toBe('backlog')
    expect(store.load().map(row => [row.id, row.status, row.order])).toEqual([
      [todo.id, 'todo', 0],
      [backlog.id, 'backlog', 1],
    ])
  })

  it('reorders cards within a column (same-column move with beforeId)', () => {
    const { controller, store } = makeController()
    const a = controller.createTask({ title: 'a', description: '', prompt: '' })!
    const b = controller.createTask({ title: 'b', description: '', prompt: '' })!
    const c = controller.createTask({ title: 'c', description: '', prompt: '' })!
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
      title: 'x', description: '', prompt: '',
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
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
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
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
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
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    controller.openTask(task.id)
    expect(controller.getSnapshot().selectedTaskId).toBe(task.id)
    controller.closeTask()
    expect(controller.getSnapshot().selectedTaskId).toBeUndefined()
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
    const { controller, store } = makeController(stub)
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
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
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
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
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
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
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
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    expect(controller.setSchedule(task.id, { enabled: true, cron: '* * * * *' })).toBe(true)
    const persisted = store.load()[0]
    expect(persisted.schedule?.enabled).toBe(true)
    expect(persisted.schedule?.cron).toBe('* * * * *')
    expect(persisted.schedule?.nextRunAt).toBeDefined()
  })

  it('rejects blank or invalid cron expressions without touching state', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    expect(controller.setSchedule(task.id, { enabled: true, cron: 'not a cron' })).toBe(false)
    expect(controller.setSchedule(task.id, { enabled: true, cron: '   ' })).toBe(false)
    expect(controller.setSchedule(task.id, { enabled: true })).toBe(false) // no existing cron → blank → rejected
    expect(store.load()[0].schedule).toBeUndefined()
  })

  it('disabling a rule clears the next run instant but keeps the cron', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    controller.setSchedule(task.id, { enabled: true, cron: '* * * * *' })
    expect(controller.setSchedule(task.id, { enabled: false })).toBe(true)
    const persisted = store.load()[0]
    expect(persisted.schedule?.enabled).toBe(false)
    expect(persisted.schedule?.cron).toBe('* * * * *')
    expect(persisted.schedule?.nextRunAt).toBeUndefined()
  })

  it('recomputes the next run when the cron changes while enabled', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    controller.setSchedule(task.id, { enabled: true, cron: '* * * * *' })
    const first = store.load()[0].schedule?.nextRunAt
    controller.setSchedule(task.id, { cron: '*/5 * * * *' })
    const second = store.load()[0].schedule?.nextRunAt
    expect(second).toBeDefined()
    expect(second).not.toBe(first)
  })

  it('applyScheduleNextRun rolls the schedule forward for the scheduler', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    controller.setSchedule(task.id, { enabled: true, cron: '* * * * *' })
    controller.applyScheduleNextRun(task.id, 1_234_567_890, 1_234_500_000)
    const persisted = store.load()[0]
    expect(persisted.schedule?.nextRunAt).toBe(1_234_567_890)
    expect(persisted.schedule?.lastTriggeredAt).toBe(1_234_500_000)
  })

  it('applyScheduleNextRun is a no-op for tasks without a schedule rule', () => {
    const { controller } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    expect(() => controller.applyScheduleNextRun(task.id, 1, 2)).not.toThrow()
    expect(controller.getSnapshot().tasks[0].schedule).toBeUndefined()
  })

  it('keeps a budgeted scheduled batch running until the final run settles', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
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
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    controller.setSchedule(task.id, { enabled: true, cron: '* * * * *', maxRuns: 2 })
    await controller.runTask(task.id)
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: exec.runCalls[0].executionId, outcome: 'failed', error: 'boom' })
    expect(store.load()[0].status).toBe('review')
    // The next tick may retry: the latest execution is settled.
    await controller.runTask(task.id)
    expect(exec.runCalls).toHaveLength(2)
  })

  it('chain mode: arming never runs; a manual run primes it and the chain continues until the budget', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    controller.setSchedule(task.id, { enabled: true, mode: 'chain', maxRuns: 2 })
    // Arming a chain never executes anything by itself.
    expect(exec.runCalls).toHaveLength(0)
    expect(store.load()[0].schedule?.primed).toBe(false)
    // The first manual run primes the rule...
    await controller.runTask(task.id)
    expect(exec.runCalls).toHaveLength(1)
    expect(store.load()[0].schedule?.primed).toBe(true)
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
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    controller.setSchedule(task.id, { enabled: true, mode: 'chain', maxRuns: 2 })
    await controller.runTask(task.id) // manual run primes the chain
    const e1 = exec.runCalls[0].executionId
    exec.runCalls[0].fire({ kind: 'started', taskId: task.id, executionId: e1, sessionId: 's-1' })
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: e1, outcome: 'failed', error: 'boom' })
    expect(exec.runCalls).toHaveLength(1) // no hand-off after a failure
    expect(store.load()[0].status).toBe('review')
    expect(store.load()[0].schedule?.enabled).toBe(true) // stays armed for the recovery tick
  })

  it('manual runs never touch the schedule counters or next-run instant', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
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
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
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
    const fresh = controller.createTask({ title: 'y', description: '', prompt: '' })!
    expect(controller.setSchedule(fresh.id, { enabled: true, mode: 'chain' })).toBe(true)
    expect(controller.setSchedule(fresh.id, { mode: 'cron' })).toBe(false)
    expect(controller.setSchedule(fresh.id, { mode: 'cron', cron: '*/5 * * * *' })).toBe(true)
  })
})

describe('comments', () => {
  /** A task with one settled execution in review (session s-1). */
  async function settledReviewTask(stub: StubExec, controller: BoardController): Promise<{ taskId: string; executionId: string }> {
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
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
    expect(exec.commentCalls).toHaveLength(0)
    expect(store.load()[0].status).toBe('review')
    // Only one open comment round at a time.
    expect(controller.submitComment(taskId, executionId, '再一句')).toBeUndefined()
  })

  it('rejects comments on unknown tasks, unsettled runs, or blank text', async () => {
    const stub = new StubExec()
    const { controller } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
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

  it('rejects comments on completed tasks', async () => {
    const stub = new StubExec()
    const { controller, store } = makeController(stub)
    const { taskId, executionId } = await settledReviewTask(stub, controller)
    controller.moveTask(taskId, 'done')
    expect(store.load()[0].status).toBe('done')
    expect(controller.submitComment(taskId, executionId, '完成了还评？')).toBeUndefined()
    expect(store.load()[0].executions).toHaveLength(1)
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

describe('auto-cruise', () => {
  it('defaults to off with a limit of 5 when nothing is stored', () => {
    const { controller } = makeController()
    expect(controller.getSnapshot().cruise).toEqual({ enabled: false, limit: 5 })
  })

  it('persists toggle and limit through the storage face', () => {
    const writes: Array<{ enabled: boolean; limit: number }> = []
    const storage = {
      read: (): { enabled: boolean; limit: number } | undefined => writes[writes.length - 1],
      write: (state: { enabled: boolean; limit: number }): void => { writes.push(state) },
    }
    const { controller } = makeController(new StubExec(), { cruiseStorage: storage })
    controller.setCruiseEnabled(true)
    controller.setCruiseLimit(3)
    expect(writes).toEqual([
      { enabled: true, limit: 5 },
      { enabled: true, limit: 3 },
    ])
    expect(controller.getSnapshot().cruise).toEqual({ enabled: true, limit: 3 })
    // Clamped to ≥ 1.
    controller.setCruiseLimit(0)
    expect(controller.getSnapshot().cruise.limit).toBe(1)
  })

  it('restores a persisted enabled cruise on start and pumps the queue', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub, {
      cruiseStorage: { read: () => ({ enabled: true, limit: 2 }), write: () => {} },
    })
    controller.createTask({ title: 'a', description: '', prompt: '' })!
    controller.createTask({ title: 'b', description: '', prompt: '' })!
    controller.createTask({ title: 'c', description: '', prompt: '' })!
    expect(exec.runCalls).toHaveLength(2) // limit 2
    expect(store.load().filter(task => task.status === 'running')).toHaveLength(2)
  })

  it('runs todo tasks up to the limit and refills when one settles', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const a = controller.createTask({ title: 'a', description: '', prompt: '' })!
    const b = controller.createTask({ title: 'b', description: '', prompt: '' })!
    const c = controller.createTask({ title: 'c', description: '', prompt: '' })!
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
    const a = controller.createTask({ title: 'a', description: '', prompt: '' })!
    controller.createTask({ title: 'b', description: '', prompt: '' })!
    controller.setCruiseLimit(1)
    controller.setCruiseEnabled(true)
    expect(exec.runCalls).toHaveLength(1)
    controller.setCruiseEnabled(false)
    exec.runCalls[0].fire({ kind: 'settled', taskId: a.id, executionId: exec.runCalls[0].executionId, outcome: 'succeeded' })
    expect(exec.runCalls).toHaveLength(1) // no refill while off
    expect(store.load().find(task => task.id === a.id)?.status).toBe('review')
  })
})
