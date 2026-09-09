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
import { createTask, ruleReadiness, withSchedule, withStatus, type TaskRecord } from '../src/core/tasks.ts'

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
  /** Native list order (workspace sections); absent = byId insertion order. */
  order: string[] | undefined = undefined
  /** Host list running flags per session id (absent id = unknown to the list). */
  runningById: Record<string, boolean> = {}
  /** Host-list pending-interaction signals per session (native amber dot). */
  waitingById: Record<string, 'approval' | 'plan-review' | 'question'> = {}
  /** Host-list workspace facts per session. */
  infoById: Record<string, { cwd?: string; workspaceId?: string; blank?: boolean; agentPreset?: string }> = {}
  /** Host-list durable title per session (absent = the host has not named it). */
  titleById: Record<string, string> = {}
  /** Registry-global archive set. */
  archivedIds: Set<string> = new Set()
  private listeners = new Set<() => void>()
  list = {
    getSnapshot: (): {
      current: string | undefined
      ids?: readonly string[]
      byId: Record<string, { running: boolean; pendingInteraction?: 'approval' | 'plan-review' | 'question'; cwd?: string; workspaceId?: string; blank?: boolean; agentPreset?: string; title?: string }>
    } => ({
      current: this.current,
      ...this.order !== undefined ? { ids: [...this.order] } : {},
      byId: Object.fromEntries(
        Object.entries(this.runningById).map(([id, running]) => [id, {
          running,
          ...this.waitingById[id] !== undefined ? { pendingInteraction: this.waitingById[id] } : {},
          ...this.infoById[id] !== undefined ? this.infoById[id] : {},
          ...this.titleById[id] !== undefined ? { title: this.titleById[id] } : {},
        }]),
      ),
    }),
    subscribe: (fn: () => void): (() => void) => {
      this.listeners.add(fn)
      return () => { this.listeners.delete(fn) }
    },
  }
  workspacesList = {
    getSnapshot: (): {
      items: readonly { id: string; title: string; sessionIds?: readonly string[] }[]
      archivedSessionIds: readonly string[]
    } => ({
      items: this.workspaceItems.map(item => ({ ...item })),
      archivedSessionIds: [...this.archivedIds] as readonly string[],
    }),
    subscribe: (fn: () => void): (() => void) => {
      this.listeners.add(fn)
      return () => { this.listeners.delete(fn) }
    },
  }
  /** Registry workspace rows (the ownership account rides each row). */
  workspaceItems: Array<{ id: string; title: string; sessionIds: string[] }> = []
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
  setInfo(id: string, info: { cwd?: string; workspaceId?: string; blank?: boolean; agentPreset?: string }): void {
    this.runningById[id] ??= false
    this.infoById[id] = info
    for (const fn of [...this.listeners]) fn()
  }
  /** Set a session's durable title and notify (list change). */
  setTitle(id: string, title: string | undefined): void {
    this.runningById[id] ??= false
    if (title === undefined) delete this.titleById[id]
    else this.titleById[id] = title
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

function makeController(stub = new StubExec(), extra: Partial<ControllerDeps> & { sessions?: FakeSessions } = {}) {
  const sessions = extra.sessions ?? new FakeSessions()
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

/** A controller whose sessions + workspaces fakes model one workspace's sidebar section. */
function makeWorkspaceController(opts: {
  workspaceId: string
  title?: string
  members: Array<{ id: string; blank?: boolean; archived?: boolean; cwd?: string; workspaceId?: string }>
  order?: string[]
}): { controller: BoardController; sessions: FakeSessions; store: InMemoryTaskStore; stub: StubExec } {
  const sessions = new FakeSessions()
  sessions.order = opts.order ?? opts.members.map(member => member.id)
  for (const member of opts.members) {
    sessions.setRunning(member.id, false)
    sessions.setInfo(member.id, {
      ...member.workspaceId !== undefined ? { workspaceId: member.workspaceId } : { workspaceId: opts.workspaceId },
      ...member.cwd !== undefined ? { cwd: member.cwd } : {},
      ...member.blank === true ? { blank: true } : {},
    })
    if (member.archived === true) sessions.archivedIds.add(member.id)
  }
  // The registry's ownership account (display order = member order unless the
  // test overrides the list order for the legacy scan path).
  sessions.workspaceItems = [{
    id: opts.workspaceId,
    title: opts.title ?? opts.workspaceId,
    sessionIds: opts.members.map(member => member.id),
  }]
  const store = new InMemoryTaskStore()
  const stub = new StubExec()
  const controller = new BoardController({
    store,
    exec: stub as unknown as ExecutionService,
    sessions,
    workspaces: { list: sessions.workspacesList },
    now: () => NOW,
    uuid,
  })
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
  it('creates and persists; a blank title with a present prompt fills at once (缺则补)', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: ' 新任务 ', description: '', prompt: 'run' })
    expect(task).toBeDefined()
    expect(controller.getSnapshot().tasks).toHaveLength(1)
    expect(store.load()[0].title).toBe('新任务')
    // Title/description/prompt are all optional at creation; a PRESENT prompt
    // fills the blank head at once — the card never reads empty-headed when
    // the content was already there.
    const blank = controller.createTask({ title: '   ', description: '', prompt: 'run' })
    expect(blank).toBeDefined()
    expect(store.load()).toHaveLength(2)
    expect(store.load()[1].title).toBe('run')
    expect(store.load()[1].description).toBe('run')
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

  it('a durable title equal to the workspace basename is the host auto-name, not a real name (→ 未命名)', () => {
    const { controller, sessions } = makeController()
    sessions.setInfo('s-1', { cwd: '/home/me/deepseek' })
    // No durable title yet → undefined (the row shows 未命名).
    expect(controller.sessionTitle('s-1')).toBeUndefined()
    // The host projects its DETERMINISTIC fallback = the project basename: still
    // not a real name, so sessionTitle reports undefined (the recurring
    // "不填标题却显示工作区名" bug — closed at the single title derivation).
    sessions.setTitle('s-1', 'deepseek')
    expect(controller.sessionTitle('s-1')).toBeUndefined()
    // A provider-generated or user-pinned name is a real title.
    sessions.setTitle('s-1', '黄道十二宫绘画')
    expect(controller.sessionTitle('s-1')).toBe('黄道十二宫绘画')
    // Windows separator + trailing slash basename still matches.
    sessions.setInfo('s-2', { cwd: 'C:\\work\\proj\\' })
    sessions.setTitle('s-2', 'proj')
    expect(controller.sessionTitle('s-2')).toBeUndefined()
  })

  it('relatedSessionIdSet covers binds, execution rounds AND the refine session', () => {
    const { controller, sessions } = makeController()
    sessions.runningById['s-refine'] = false
    sessions.runningById['s-run'] = false
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-bind' })
    // Give the task a refine session + an execution round (pure task shape).
    const withExtras: TaskRecord = {
      ...controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!,
      refineSessionId: 's-refine',
      executions: [{ id: 'e1', sessionId: 's-run', startedAt: NOW, endedAt: NOW, result: 'succeeded', error: undefined }],
    }
    // The refine session is IN the related set — the old hand-rolled bind+
    // execution set missed it and let the add-session picker offer to re-bind it.
    const set = controller.relatedSessionIdSet(withExtras)
    expect([...set].sort()).toEqual(['s-bind', 's-refine', 's-run'])
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

  it('a blank edit title is allowed when there is no prompt; an unknown task is rejected without touching state', () => {
    const { controller, store } = makeController()
    const bare = controller.createTask({ title: 'x', description: '', prompt: '' })!
    // No prompt = nothing to derive: a blank title stays legal (未命名 card).
    expect(controller.updateTask(bare.id, { title: '   ' })).toBe(true)
    expect(store.load()[0].title).toBe('')
    // With a prompt present the 缺则补 supplement fills a blank head at once
    // (the user demand: empty title/description auto-fill from the prompt).
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    expect(controller.updateTask(task.id, { title: '   ' })).toBe(true)
    expect(store.load().find(candidate => candidate.id === task.id)?.title).toBe('run')
    expect(controller.updateTask('missing', { title: 'y' })).toBe(false)
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

  it('markTaskViewed clears one card without navigating', async () => {
    let clock = NOW
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub, { now: () => clock })
    const a = controller.createTask({ title: 'a', description: '', prompt: 'p' })!
    const b = controller.createTask({ title: 'b', description: '', prompt: 'p' })!
    clock = NOW + 1_000
    await controller.runTask(a.id)
    clock = NOW + 1_500
    exec.runCalls[0].fire({ kind: 'settled', taskId: a.id, executionId: exec.runCalls[0].executionId, outcome: 'succeeded' })
    expect(taskUnviewed(controller.getSnapshot().tasks.find(task => task.id === a.id)!)).toBe(true)
    clock = NOW + 2_000
    controller.markTaskViewed(a.id)
    expect(taskUnviewed(controller.getSnapshot().tasks.find(task => task.id === a.id)!)).toBe(false)
    expect(store.load().find(task => task.id === a.id)!.viewedAt).toBe(NOW + 2_000)
    // Untouched cards keep their baselines; selection never moves.
    expect(controller.getSnapshot().selectedTaskId).toBeUndefined()
    expect(b.viewedAt).toBe(NOW)
  })

  it('markTasksViewed clears an explicit id set in one write', async () => {
    let clock = NOW
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub, { now: () => clock })
    const a = controller.createTask({ title: 'a', description: '', prompt: 'p' })!
    const b = controller.createTask({ title: 'b', description: '', prompt: 'p' })!
    clock = NOW + 1_000
    await controller.runTask(a.id)
    await controller.runTask(b.id)
    clock = NOW + 1_500
    for (const call of exec.runCalls) {
      call.fire({ kind: 'settled', taskId: call.taskId, executionId: call.executionId, outcome: 'succeeded' })
    }
    clock = NOW + 2_000
    controller.markTasksViewed([a.id, 'unknown-id'])
    const tasks = controller.getSnapshot().tasks
    expect(taskUnviewed(tasks.find(task => task.id === a.id)!)).toBe(false)
    expect(taskUnviewed(tasks.find(task => task.id === b.id)!)).toBe(true)
  })

  it('openTaskFromNotification navigates AND clears the whole related set (one funnel)', async () => {
    let clock = NOW
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub, { now: () => clock })
    const a = controller.createTask({ title: 'a', description: '', prompt: 'p' })!
    clock = NOW + 1_000
    await controller.runTask(a.id)
    clock = NOW + 1_500
    exec.runCalls[0].fire({ kind: 'settled', taskId: a.id, executionId: exec.runCalls[0].executionId, outcome: 'succeeded' })
    expect(taskUnviewed(controller.getSnapshot().tasks.find(task => task.id === a.id)!)).toBe(true)
    clock = NOW + 2_000
    controller.openTaskFromNotification(a.id)
    // Navigated like openTask, but the full related set reads viewed.
    expect(controller.getSnapshot().selectedTaskId).toBe(a.id)
    expect(taskUnviewed(controller.getSnapshot().tasks.find(task => task.id === a.id)!)).toBe(false)
    // Unknown ids are ignored (no selection change, no throw).
    controller.openTaskFromNotification('unknown-id')
    expect(controller.getSnapshot().selectedTaskId).toBe(a.id)
  })

  it('markTaskSessionViewed clears one session rounds, siblings keep their dots', async () => {
    let clock = NOW
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub, { now: () => clock })
    const base = controller.createTask({ title: 'a', description: '', prompt: 'p' })!
    // Two rounds on two sessions of the same task, both settled (both unread).
    clock = NOW + 1_000
    await controller.runTask(base.id)
    const first = exec.runCalls[0]
    first.fire({ kind: 'started', taskId: base.id, executionId: first.executionId, sessionId: 's-1' })
    clock = NOW + 1_500
    first.fire({ kind: 'settled', taskId: base.id, executionId: first.executionId, outcome: 'succeeded' })
    clock = NOW + 2_000
    await controller.runTask(base.id)
    const second = exec.runCalls[1]
    second.fire({ kind: 'started', taskId: base.id, executionId: second.executionId, sessionId: 's-2' })
    clock = NOW + 2_500
    second.fire({ kind: 'settled', taskId: base.id, executionId: second.executionId, outcome: 'succeeded' })
    clock = NOW + 3_000
    controller.markTaskSessionViewed(base.id, 's-1')
    const rounds = controller.getSnapshot().tasks.find(task => task.id === base.id)!.executions
    expect(rounds.find(round => round.id === first.executionId)!.viewedAt).toBe(NOW + 3_000)
    expect(rounds.find(round => round.id === second.executionId)!.viewedAt).not.toBe(NOW + 3_000)
    // Unknown task/session pairs are ignored.
    controller.markTaskSessionViewed('unknown-id', 's-1')
    controller.markTaskSessionViewed(base.id, 'unknown-session')
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

  it('the delivery watchdog releases an open round whose session never produced evidence', async () => {
    let clock = NOW
    const stub = new StubExec()
    stub.reconcileResult = undefined // no turn evidence, ever
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = false // the session is idle
    const store = new InMemoryTaskStore()
    const seeded = createTask({ title: 'x', description: '', prompt: 'run', status: 'running' }, NOW, 'task-a')
    store.save([{
      ...seeded,
      executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
    }])
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => clock, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    // Past the watchdog deadline with an idle session: the round is released
    // (cancelled) instead of holding the slot and swallowing future turns.
    clock = NOW + 4 * 60_000
    sessions.setRunning('s-1', false)
    await flush()
    await flush()
    const settled = store.load()[0]
    expect(settled.executions[0].endedAt).toBeDefined()
    expect(settled.executions[0].result).toBe('cancelled')
    // A still-running session is NEVER judged (a long run is not a zombie).
    const still = store.load()[0]
    expect(still.status).not.toBe('running')
  })

  it('a parked card with an open round is swept by the watchdog too (the orphan case)', async () => {
    let clock = NOW
    const stub = new StubExec()
    stub.reconcileResult = undefined
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = false
    const store = new InMemoryTaskStore()
    // A legacy/orphaned row: open round, card parked in backlog (pre-fix drag).
    const seeded = createTask({ title: 'x', description: '', prompt: 'run', status: 'backlog' }, NOW, 'task-a')
    store.save([{
      ...seeded,
      executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
    }])
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => clock, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    clock = NOW + 4 * 60_000
    sessions.setRunning('s-1', false)
    await flush()
    await flush()
    // The zombie no longer exists → the session's next native turn can drive
    // the card again (the "行亮着、卡片永远不动" permanent state is gone).
    expect(store.load()[0].executions[0].endedAt).toBeDefined()
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

  it('keeps a budgeted scheduled batch running until the final run (fire counts at launch)', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setSchedule(task.id, { enabled: true, cron: '* * * * *', maxRuns: 3 })

    // Real scheduler order: the counter is persisted at fire-accept — BEFORE
    // the run can settle — so a settled scheduled run is already counted.
    await controller.runTask(task.id)
    const e1 = exec.runCalls[0].executionId
    controller.applyScheduleNextRun(task.id, NOW + 60_000, NOW, 1)
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: e1, outcome: 'succeeded' })
    // Run 1 of 3: the batch is not complete, the card stays 'running' so the
    // scheduler can fire the next run.
    expect(store.load()[0].status).toBe('running')
    expect(store.load()[0].executions[0].result).toBe('succeeded')

    // Run 2 of 3: still within budget. A settle-then-count ordering would
    // land 'review' here and the next tick would skip the final fire via the
    // column pause — the batch would silently run one run short.
    await controller.runTask(task.id)
    expect(exec.runCalls).toHaveLength(2)
    const e2 = exec.runCalls[1].executionId
    controller.applyScheduleNextRun(task.id, NOW + 120_000, NOW, 2)
    exec.runCalls[1].fire({ kind: 'settled', taskId: task.id, executionId: e2, outcome: 'succeeded' })
    expect(store.load()[0].status).toBe('running')

    // Run 3 is the final budgeted run → disarmed at fire, settles into review.
    await controller.runTask(task.id)
    const e3 = exec.runCalls[2].executionId
    controller.applyScheduleNextRun(task.id, undefined, NOW, 3, true)
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

  it('manually moving a chain card to todo keeps the chain armed (only done stops it)', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.setSchedule(task.id, { enabled: true, mode: 'chain', maxRuns: undefined })
    expect(exec.runCalls).toHaveLength(1) // armed chain starts immediately
    const e1 = exec.runCalls[0].executionId
    exec.runCalls[0].fire({ kind: 'started', taskId: task.id, executionId: e1, sessionId: 's-1' })
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: e1, outcome: 'succeeded' })
    expect(exec.runCalls).toHaveLength(2) // the chain hands off to the next run
    // A manual card move (except done) never disarms the rule: the chain only
    // continues at settle — moving around must never kill 完成后接续.
    controller.moveTask(task.id, 'todo')
    const after = store.load()[0]
    expect(after.schedule?.enabled).toBe(true)
    expect(after.status).toBe('todo')
  })

  it('an armed chain starts its FIRST run at arming even from a shelved column (no manual re-run needed)', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    // Armed while the card sits in review (the user just reviewed it and said
    // "keep going"): the first run starts at once — 完成后接续 never waits
    // for a manual re-run.
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run', status: 'review' })!
    controller.setSchedule(task.id, { enabled: true, mode: 'chain', maxRuns: 2 })
    expect(exec.runCalls).toHaveLength(1)
    expect(store.load()[0].status).toBe('running')
  })

  it('an armed chain in backlog also starts at arming (any column); the todo resume path is idempotent', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run', status: 'backlog' })!
    controller.setSchedule(task.id, { enabled: true, mode: 'chain', maxRuns: 2 })
    // Arming with an executable prompt starts the first run regardless of
    // the column — no manual re-run, no move required.
    expect(exec.runCalls).toHaveLength(1)
    expect(store.load()[0].schedule?.enabled).toBe(true)
    // Moving to todo while a run is open must not launch a duplicate (the
    // card just changes column; the open run stays the one in flight).
    controller.moveTask(task.id, 'todo')
    expect(exec.runCalls).toHaveLength(1)
    expect(store.load()[0].status).toBe('todo')
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

  it('keeps a comment pending while ITS OWN session is busy, and injects it into an idle one', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    controller.setCruiseEnabled(true)
    const { taskId } = await settledReviewTask(stub, controller)
    // A second run puts the card back to 进行中 on a NEW session (s-2).
    await controller.runTask(taskId)
    const run = stub.runCalls[stub.runCalls.length - 1]
    run.fire({ kind: 'started', taskId, executionId: run.executionId, sessionId: 's-2' })
    expect(store.load()[0].status).toBe('running')
    // A comment for the BUSY session waits: one conversation takes one turn.
    const busy = controller.submitSessionComment(taskId, 's-2', '先存着')
    expect(busy).toBeDefined()
    expect(exec.commentCalls).toHaveLength(0)
    expect(busy?.endedAt).toBeUndefined()
    // A comment for the card's OTHER, idle session (s-1) does NOT wait for it:
    // the lane is the session, not the card (the reported 「排队等另一个会话」).
    controller.submitSessionComment(taskId, 's-1', '另一条会话现在就能发')
    expect(exec.commentCalls.map(call => call.sessionId)).toEqual(['s-1'])
  })

  it('a run whose session is not bound yet holds the card: no comment slips into a lane being acquired', async () => {
    // `connectSession` resolves asynchronously and can hand back a session the
    // card already has work in. Admitting a comment during that window would
    // put two rounds on one session — so an UNBOUND in-flight round blocks
    // admission for the whole card until `started` names its lane.
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub)
    controller.setCruiseEnabled(true)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    await controller.runTask(task.id)
    expect(stub.runCalls).toHaveLength(1) // 'started' deliberately NOT fired yet
    controller.submitSessionComment(task.id, 's-1', '别插进来')
    expect(exec.commentCalls).toHaveLength(0)
    // The lane binds to a DIFFERENT session → s-1 is provably idle → it goes.
    const run = stub.runCalls[0]
    run.fire({ kind: 'started', taskId: task.id, executionId: run.executionId, sessionId: 's-9' })
    expect(exec.commentCalls.map(call => call.sessionId)).toEqual(['s-1'])
  })

  it('a run that binds to the very session a comment waits for keeps that comment queued', async () => {
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub)
    controller.setCruiseEnabled(true)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    await controller.runTask(task.id)
    const run = stub.runCalls[0]
    controller.submitSessionComment(task.id, 's-1', '等这条会话')
    run.fire({ kind: 'started', taskId: task.id, executionId: run.executionId, sessionId: 's-1' })
    expect(exec.commentCalls).toHaveLength(0)
    run.fire({ kind: 'settled', taskId: task.id, executionId: run.executionId, outcome: 'succeeded' })
    expect(exec.commentCalls.map(call => call.sessionId)).toEqual(['s-1'])
  })

  it('injects a pending comment when its own session settles back (cruise on)', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    controller.setCruiseEnabled(true)
    const { taskId } = await settledReviewTask(stub, controller)
    // The card runs again on s-2; a comment for THAT session stays pending.
    await controller.runTask(taskId)
    const run = stub.runCalls[stub.runCalls.length - 1]
    run.fire({ kind: 'started', taskId, executionId: run.executionId, sessionId: 's-2' })
    controller.submitSessionComment(taskId, 's-2', '等这条会话结算后注入')
    expect(exec.commentCalls).toHaveLength(0)
    // The session's round settles → the lane is free → the pending comment
    // injects automatically (and the card goes back to 进行中 to run it).
    run.fire({ kind: 'settled', taskId, executionId: run.executionId, outcome: 'succeeded' })
    expect(exec.commentCalls).toHaveLength(1)
    expect(exec.commentCalls[0].sessionId).toBe('s-2')
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

  it('a queued comment carries its images on the round (the send mode is the toggle, never the pictures)', async () => {
    const stub = new StubExec()
    const { controller, store } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    const round = controller.submitSessionComment(task.id, 'linked-7', '看图', false, [{ mediaType: 'image/png', data: 'RkZG', name: 'a.png' }])
    expect(round?.promptImages).toEqual([{ mediaType: 'image/png', data: 'RkZG', name: 'a.png' }])
    // Persisted on the shared doc so every device sees the queued picture.
    expect(store.load()[0].executions[0].promptImages).toEqual([{ mediaType: 'image/png', data: 'RkZG', name: 'a.png' }])
  })

  it('a queued comment carries its file refs on the round (same queueing as images)', async () => {
    const stub = new StubExec()
    const { controller, store } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    const round = controller.submitSessionComment(task.id, 'linked-7', '看文件', false, undefined,
      [{ receiptId: 'rcpt-1', name: 'a.pdf', bytes: 10 }])
    expect(round?.promptFiles).toEqual([{ receiptId: 'rcpt-1', name: 'a.pdf', bytes: 10 }])
    expect(store.load()[0].executions[0].promptFiles).toEqual([{ receiptId: 'rcpt-1', name: 'a.pdf', bytes: 10 }])
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

  it('comments on two DIFFERENT sessions both inject at once (the budget is the only gate)', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const { taskId, executionId } = await settledReviewTask(stub, controller)
    // First an execution-anchored comment…
    controller.submitComment(taskId, executionId, '先从执行')
    // …then a session-anchored one into a DIFFERENT session.
    controller.submitSessionComment(taskId, 'linked-7', '再驱动')
    expect(store.load()[0].executions.filter(round => round.comment !== undefined)).toHaveLength(2)
    // Cruise on: two idle sessions are two lanes — with budget room both go,
    // in submission order. Serializing them behind each other was the bug.
    controller.setCruiseEnabled(true)
    expect(exec.commentCalls.map(call => call.sessionId)).toEqual(['s-1', 'linked-7'])
    expect(store.load()[0].status).toBe('running')
  })

  it('the concurrency budget still throttles them: limit 1 = one lane at a time', async () => {
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub)
    const { taskId, executionId } = await settledReviewTask(stub, controller)
    controller.submitComment(taskId, executionId, '第一条')
    controller.submitSessionComment(taskId, 'linked-7', '第二条')
    // The budget is set BEFORE the cruise opens: with one slot, the two idle
    // lanes do not both start — the second waits for the first to settle.
    controller.setCruiseLimit(1)
    controller.setCruiseEnabled(true)
    expect(exec.commentCalls).toHaveLength(1)
    exec.commentCalls[0].fire({ kind: 'settled', taskId, executionId: exec.commentCalls[0].executionId, outcome: 'succeeded' })
    expect(exec.commentCalls).toHaveLength(2)
  })

  it('a queued comment on an IDLE session of a busy card injects at once (per-session lanes)', async () => {
    // The user's report: one session of the card is running, they leave a
    // QUEUED comment on ANOTHER session of the same card, and it sits at
    // 「排队第 1 位」 until the first conversation finishes — while auto cruise
    // is on with a concurrency limit of 3 and nothing else running. Two
    // sessions are two conversations: the lane is the SESSION, the card is
    // only where their state aggregates.
    const stub = new StubExec()
    const { controller } = makeController(stub)
    const task = controller.createTask({ title: '两路会话', description: '', prompt: 'run' })!
    controller.setCruiseEnabled(true)
    controller.setCruiseLimit(3)
    // A plain run occupies the card's own session (the card is 进行中).
    await controller.runTask(task.id)
    const run = stub.runCalls[0]
    run.fire({ kind: 'started', taskId: task.id, executionId: run.executionId, sessionId: 's-busy' })
    expect(controller.getSnapshot().tasks[0].status).toBe('running')
    // A comment on a DIFFERENT, idle session must not wait for it.
    controller.submitSessionComment(task.id, 's-idle', '另一条会话的话')
    expect(stub.commentCalls.map(call => call.sessionId)).toEqual(['s-idle'])
    // Both are in flight now: the card stays 进行中 until the LAST one settles.
    stub.commentCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: stub.commentCalls[0].executionId, outcome: 'succeeded' })
    expect(controller.getSnapshot().tasks[0].status).toBe('running')
    run.fire({ kind: 'settled', taskId: task.id, executionId: run.executionId, outcome: 'succeeded' })
    expect(controller.getSnapshot().tasks[0].status).toBe('review')
  })

  it('two comments on the SAME session stay strictly ordered (a session takes one turn at a time)', async () => {
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub)
    controller.setCruiseEnabled(true)
    controller.setCruiseLimit(3)
    // A settled card (not a todo one: a todo card would also be cruise-picked
    // up, and that run's lane is the subject of another test below).
    const { taskId } = await settledReviewTask(stub, controller)
    const first = controller.submitSessionComment(taskId, 's-1', '第一句')!
    const second = controller.submitSessionComment(taskId, 's-1', '第二句')!
    expect(exec.commentCalls.map(call => call.executionId)).toEqual([first.id])
    exec.commentCalls[0].fire({ kind: 'settled', taskId, executionId: first.id, outcome: 'succeeded' })
    expect(exec.commentCalls.map(call => call.executionId)).toEqual([first.id, second.id])
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

describe('referenceSessionOf (官方 @ 菜单的目标会话解析)', () => {
  it('resolves the task own related session first (refine → execution → linked)', () => {
    const { controller, sessions } = makeController()
    sessions.setCurrent('native-current')
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    // A bound session makes it the task's own related session.
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 'bound-1' })
    expect(controller.referenceSessionOf(task.id)).toBe('bound-1')
    expect(controller.referenceSessionOf(undefined)).toBe('native-current')
  })

  it('falls back to the staged native session, then the first list entry', () => {
    const { controller, sessions } = makeController()
    sessions.setCurrent('staged')
    expect(controller.referenceSessionOf(undefined)).toBe('staged')
    sessions.setCurrent(undefined)
    sessions.setRunning('only-one', false)
    expect(controller.referenceSessionOf(undefined)).toBe('only-one')
  })

  it('returns undefined only when there is no task session and no native session', () => {
    const { controller } = makeController()
    expect(controller.referenceSessionOf(undefined)).toBeUndefined()
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

  it('stores soft WIP ceilings advisory-only (empty = unlimited, never pumps)', () => {
    const { controller } = makeController()
    expect(controller.getSnapshot().cruise.wip).toBeUndefined()
    controller.setWipLimit('running', 3)
    expect(controller.getSnapshot().cruise.wip).toEqual({ running: 3 })
    controller.setWipLimit('global', 999)
    expect(controller.getSnapshot().cruise.wip).toEqual({ running: 3, global: 20 })
    controller.setWipLimit('running', 2.7)
    expect(controller.getSnapshot().cruise.wip).toEqual({ running: 2, global: 20 })
    controller.setWipLimit('global', Number.NaN)
    expect(controller.getSnapshot().cruise.wip).toEqual({ running: 2, global: 20 })
    controller.setWipLimit('running', undefined)
    controller.setWipLimit('global', undefined)
    expect(controller.getSnapshot().cruise.wip).toBeUndefined()
  })

  it('mirrors scheduler skip telemetry read-only (zero stays hidden, never an edit)', () => {
    const { controller } = makeController()
    expect(controller.getSnapshot().skips).toEqual({ overlap: 0, missed: 0 })
    controller.setSchedulerSkips({ overlap: 2, missed: 1 })
    expect(controller.getSnapshot().skips).toEqual({ overlap: 2, missed: 1 })
    // Same ledger re-set is a no-op (dedupes per-tick echo).
    controller.setSchedulerSkips({ overlap: 2, missed: 1 })
    expect(controller.getSnapshot().skips).toEqual({ overlap: 2, missed: 1 })
  })

  it('mirrors the scheduler heartbeat stamp volatile-only (undefined until the first tick)', () => {
    const { controller } = makeController()
    expect(controller.getSnapshot().heartbeat).toEqual({ lastOkAt: undefined })
    controller.setSchedulerHeartbeat(1_000_000)
    expect(controller.getSnapshot().heartbeat).toEqual({ lastOkAt: 1_000_000 })
    controller.setSchedulerHeartbeat(1_000_000)
    expect(controller.getSnapshot().heartbeat).toEqual({ lastOkAt: 1_000_000 })
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

  it('rejects refine for an all-blank task (no requirement to research)', () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const blank = createTask({ title: '  ', description: ' ', prompt: '' }, NOW, 'task-blank')
    store.save([{ ...blank, status: 'backlog' }])
    const { controller } = makeController(stub, { store })
    expect(controller.startRefine('task-blank')).toBe(false)
    expect(stub.runCalls).toHaveLength(0)
    expect(store.load()[0].executions).toHaveLength(0)
  })

  it('a natively-running pre-bind refine session is never recorded as external (no column move)', async () => {
    // The first refine round is born with sessionId undefined; the native
    // session appears in the list BEFORE the started event binds it. That
    // window must not record an out-of-band round (the session is
    // board-owned from conception) and must never move the column.
    const stub = new StubExec()
    const sessions = new FakeSessions()
    const store = new InMemoryTaskStore()
    seedTask(store, { status: 'backlog' })
    const { controller } = makeController(stub, { store, sessions, reconcileDebounceMs: 0 })
    expect(controller.startRefine('task-a')).toBe(true)
    sessions.setRunning('s-refine', true)
    await flush()
    const mid = store.load()[0]
    expect(mid.status).toBe('backlog')
    expect(mid.executions).toHaveLength(1)
    expect(mid.executions[0].external).not.toBe(true)
    // The late started event binds the session; the running turn stays
    // board-owned (busy lane), still no external round, still backlog.
    const call = stub.runCalls[0]
    call.fire({ kind: 'started', taskId: 'task-a', executionId: call.executionId, sessionId: 's-refine' })
    await flush()
    const bound = store.load()[0]
    expect(bound.status).toBe('backlog')
    expect(bound.executions).toHaveLength(1)
    expect(bound.refineSessionId).toBe('s-refine')
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

  it('a natively ARCHIVED bound session leaves the card rows; un-archive restores it', async () => {
    const wss = workspaces()
    wss.items = [{ id: 'w-a', title: '项目A', sessionIds: [] }]
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = false
    const controller = new BoardController({
      store: new InMemoryTaskStore(),
      exec: new StubExec() as unknown as ExecutionService,
      sessions,
      workspaces: wss,
      now: () => NOW,
      uuid,
      reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })
    await flush()
    const current = () => controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.sessionsOf(current()).map(row => row.sessionId)).toEqual(['s-1'])
    // Native archive (the registry set flips + notifies): the row leaves the
    // card on this replica immediately — derived, never ledger, zero sync lag.
    wss.archivedSessionIds = ['s-1']
    wss.notify()
    await flush()
    expect(controller.sessionsOf(current())).toHaveLength(0)
    expect(controller.linkedOf(current())).toHaveLength(0)
    // Un-archive restores the row (the bind and its history were never touched).
    wss.archivedSessionIds = []
    wss.notify()
    await flush()
    expect(controller.sessionsOf(current()).map(row => row.sessionId)).toEqual(['s-1'])
  })

  it('an archived session with a run round hides the row but keeps the ledger round', async () => {
    const wss = workspaces()
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = false
    const store = new InMemoryTaskStore()
    const seeded = createTask({ title: 'x', description: '', prompt: 'run' }, NOW, 'task-a')
    store.save([{
      ...seeded,
      executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: NOW + 1, result: 'succeeded', error: undefined }],
    }])
    const controller = new BoardController({
      store, exec: new StubExec() as unknown as ExecutionService,
      sessions, workspaces: wss, now: () => NOW, uuid,
    })
    controller.start()
    const task = () => controller.getSnapshot().tasks[0]
    expect(controller.sessionsOf(task()).map(row => row.sessionId)).toEqual(['s-1'])
    wss.archivedSessionIds = ['s-1']
    wss.notify()
    expect(controller.sessionsOf(task())).toHaveLength(0)
    // The execution record itself is untouched (un-archive restores the row
    // with its full history).
    expect(task().executions).toHaveLength(1)
  })

  it('createBoundTask creates a bound task, persists it, and lands in the chosen column', () => {
    const { controller, store } = makeController()
    const created = controller.createBoundTask({ kind: 'session', sessionId: 's-1' }, {
      title: '会话一', description: '', prompt: 'run', status: 'todo',
    })
    expect(created).toBeDefined()
    expect(created?.binds).toEqual([{ kind: 'session', sessionId: 's-1' }])
    expect(controller.getSnapshot().tasks[0].status).toBe('todo')
    expect(store.load()[0].binds).toEqual([{ kind: 'session', sessionId: 's-1' }])
    // A blank title with a PRESENT prompt fills at once (缺则补 — the card
    // never reads empty-headed when the content was already there).
    const blank = controller.createBoundTask({ kind: 'workspace', workspaceId: 'w-a' }, {
      title: '  ', description: '', prompt: 'run', status: 'todo',
    })!
    expect(blank.title).toBe('run')
    expect(blank.description).toBe('run')
  })

  it('createBoundTask honors any landing column (external drops stay where dropped)', () => {    const { controller } = makeController()
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

  it('createBoundTask on a workspace snapshots its live sessions as explicit rows (archived/blank excluded)', () => {
    const { controller, store } = makeWorkspaceController({
      workspaceId: 'w-a',
      members: [
        { id: 's-live-1' },
        { id: 's-live-2' },
        { id: 's-archived', archived: true },
        { id: 's-blank', blank: true },
      ],
    })
    const created = controller.createBoundTask({ kind: 'workspace', workspaceId: 'w-a' }, {
      title: 'w', description: '', prompt: 'run', status: 'todo',
    })!
    // The workspace bind stays first (source association); live members join
    // as explicit session binds in native list order.
    expect(created.binds).toEqual([
      { kind: 'workspace', workspaceId: 'w-a' },
      { kind: 'session', sessionId: 's-live-1' },
      { kind: 'session', sessionId: 's-live-2' },
    ])
    expect(store.load()[0].binds).toEqual(created.binds)
    // The rows derive at once (archived/blank never surface).
    const rows = controller.linkedOf(created).map(row => row.sessionId)
    expect(rows).toEqual(['s-live-1', 's-live-2'])
  })

  it('createBoundTask on an empty workspace still creates the card (zero snapshot rows)', () => {
    const { controller } = makeWorkspaceController({ workspaceId: 'w-empty', members: [] })
    const created = controller.createBoundTask({ kind: 'workspace', workspaceId: 'w-empty' }, {
      title: 'w', description: '', prompt: 'run', status: 'todo',
    })!
    expect(created.binds).toEqual([{ kind: 'workspace', workspaceId: 'w-empty' }])
    expect(controller.linkedOf(created)).toEqual([])
  })

  it('workspace snapshot never re-fires: later sessions do not auto-join', () => {
    const { controller, sessions } = makeWorkspaceController({
      workspaceId: 'w-a',
      members: [{ id: 's-live-1' }],
    })
    const created = controller.createBoundTask({ kind: 'workspace', workspaceId: 'w-a' }, {
      title: 'w', description: '', prompt: 'run', status: 'todo',
    })!
    expect(created.binds).toEqual([
      { kind: 'workspace', workspaceId: 'w-a' },
      { kind: 'session', sessionId: 's-live-1' },
    ])
    // A session born AFTER the drop never joins on its own.
    sessions.setRunning('s-late', false)
    sessions.setInfo('s-late', { workspaceId: 'w-a' })
    sessions.order = [...(sessions.order ?? []), 's-late']
    const rows = controller.linkedOf(controller.getSnapshot().tasks.find(task => task.id === created.id)!)
      .map(row => row.sessionId)
    expect(rows).toEqual(['s-live-1'])
  })

  it('workspace snapshot reads the ownership account, never cwd-title guessing', () => {
    // Same-named folders elsewhere are NOT this workspace: a foreign session
    // whose cwd basename collides with the workspace title must not join,
    // while an owned session with a misleading cwd still does.
    const harness = makeWorkspaceController({
      workspaceId: 'w-a',
      title: 'proj',
      members: [{ id: 's-owned', cwd: '/elsewhere/other' }],
    })
    harness.sessions.setRunning('s-stranger', false)
    harness.sessions.setInfo('s-stranger', { workspaceId: 'w-other', cwd: '/data/proj' })
    const created = harness.controller.createBoundTask({ kind: 'workspace', workspaceId: 'w-a' }, {
      title: 'w', description: '', prompt: 'run', status: 'todo',
    })!
    expect(created.binds).toEqual([
      { kind: 'workspace', workspaceId: 'w-a' },
      { kind: 'session', sessionId: 's-owned' },
    ])
  })

  it('workspace snapshot skips stale ownership slots (unknown ids are never guessed)', () => {
    const harness = makeWorkspaceController({
      workspaceId: 'w-a',
      members: [{ id: 's-live-1' }],
    })
    // The registry account still names a session that has since vanished.
    harness.sessions.workspaceItems = [{
      id: 'w-a', title: 'w-a', sessionIds: ['s-live-1', 's-gone'],
    }]
    const created = harness.controller.createBoundTask({ kind: 'workspace', workspaceId: 'w-a' }, {
      title: 'w', description: '', prompt: 'run', status: 'todo',
    })!
    expect(created.binds).toEqual([
      { kind: 'workspace', workspaceId: 'w-a' },
      { kind: 'session', sessionId: 's-live-1' },
    ])
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

  it('a folder bound onto an existing task NEVER surfaces folder sessions (the flood is sealed)', () => {
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
    // The bind is persisted (it is the card's source association)…
    const bound = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(bound.binds).toEqual([{ kind: 'workspace', workspaceId: 'w-a' }])
    // …but the folder's conversations are NOT rows: neither the existing
    // session nor one opened later ever appears (the old live-derivation was
    // the "主界面新建会话突然进卡片" bug).
    expect(controller.sessionsOf(bound).map(row => row.sessionId)).toEqual([])
    wss.items = [{ id: 'w-a', title: '项目A', sessionIds: ['s-1', 's-2'] }]
    sessions.runningById['s-2'] = false
    wss.notify()
    expect(controller.sessionsOf(bound).map(row => row.sessionId)).toEqual([])
    // An explicit session bind DOES surface its row.
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-2' })
    const withSession = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.sessionsOf(withSession).map(row => row.sessionId)).toEqual(['s-2'])
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

  it('copyTask carries the accent color and the TASK-level automation, but NEVER the session rules', () => {
    const stub = new StubExec()
    const { controller } = makeController(stub)
    const source = controller.createTask({ title: '源', description: '', prompt: 'run' })!
    controller.setTaskColor(source.id, '#4f46e5')
    controller.setSchedule(source.id, { enabled: true, mode: 'cron', cron: '0 9 * * *' })
    controller.createSessionRule(source.id, { sessionId: 's-1', instruction: '继续', cron: '0 * * * *', send: 'steer' })
    const copy = controller.copyTask(source.id)
    expect(copy).toBeDefined()
    expect(copy!.color).toBe('#4f46e5')
    // The TASK-level schedule is the card's own shape — it comes along.
    expect(copy!.schedule).toMatchObject({ enabled: true, mode: 'cron', cron: '0 9 * * *', runCount: 0 })
    // Session rules automate the SOURCE's own sessions (the 绘画): the template
    // is a new card with none of them — copying would automate nothing real.
    expect(copy!.rules).toBeUndefined()
  })
  it('copyTask copies an armed CHAIN schedule with its budget (runCount reset)', () => {
    const stub = new StubExec()
    const { controller } = makeController(stub)
    const source = controller.createTask({ title: '源', description: '', prompt: 'run' })!
    controller.setSchedule(source.id, { enabled: true, mode: 'chain', maxRuns: 7 })
    const copy = controller.copyTask(source.id)
    expect(copy!.schedule).toMatchObject({ enabled: true, mode: 'chain', maxRuns: 7, runCount: 0 })
  })

  it('copyTask carries the prompt images (they are part of the card\'s prompt)', () => {
    const stub = new StubExec()
    const { controller } = makeController(stub)
    const source = controller.createTask({
      title: '源', description: '', prompt: 'run',
      promptImages: [{ mediaType: 'image/webp', data: 'QUJD', name: 'a.webp' }],
    })!
    const copy = controller.copyTask(source.id)
    expect(copy!.promptImages).toEqual([{ mediaType: 'image/webp', data: 'QUJD', name: 'a.webp' }])
    // Copied, not aliased: the template is an independent record.
    expect(copy!.promptImages![0]).not.toBe(source.promptImages![0])
  })

  it('updateTask writes and clears the prompt image set as one whole', () => {
    const stub = new StubExec()
    const { controller, store } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.updateTask(task.id, { promptImages: [{ mediaType: 'image/png', data: 'RkZG' }] })
    expect(store.load()[0].promptImages).toEqual([{ mediaType: 'image/png', data: 'RkZG' }])
    // An empty set CLEARS the key (the form removed every image).
    controller.updateTask(task.id, { promptImages: [] })
    expect(store.load()[0].promptImages).toBeUndefined()
    // An ABSENT key never touches the stored set.
    controller.updateTask(task.id, { promptImages: [{ mediaType: 'image/png', data: 'RkZG' }] })
    controller.updateTask(task.id, { title: '改名' })
    expect(store.load()[0].promptImages).toEqual([{ mediaType: 'image/png', data: 'RkZG' }])
  })

  it('cruise windows v4: the switch is sovereign — boundaries flip it, edits never do', () => {
    const stub = new StubExec()
    const { controller } = makeController(stub, { now: () => NOW })
    // A future window: still off now, the heartbeat flips it on at its start.
    controller.setCruiseSchedule([{ startAt: NOW + 1000 }])
    expect(controller.getSnapshot().cruise.enabled).toBe(false)
    controller.tickCruise(NOW + 2000)
    expect(controller.getSnapshot().cruise.enabled).toBe(true)
    // REMOVING the window keeps the switch exactly where it is (no recompute):
    controller.setCruiseSchedule([])
    expect(controller.getSnapshot().cruise.enabled).toBe(true)
    // Manual off → removing/adding future windows never turns it back on.
    controller.setCruiseEnabled(false)
    controller.setCruiseSchedule([{ startAt: NOW + 1000, endAt: NOW + 2000 }])
    expect(controller.getSnapshot().cruise.enabled).toBe(false)
    // An ADDED only-end window fires its start boundary at creation.
    controller.setCruiseSchedule([{ endAt: NOW + 60_000 }])
    expect(controller.getSnapshot().cruise.enabled).toBe(true)
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

  it('externalKindOf classifies sidebar ids; linkedOf surfaces ONLY explicit session binds', () => {
    const wss = workspaces()
    wss.items = [{ id: 'w-a', title: '项目A', sessionIds: ['s-1', 's-2'] }]
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
    // A workspace bind contributes no rows — membership is never derived.
    const workspaceTask: TaskRecord = taskWithBind({ kind: 'workspace', workspaceId: 'w-a' })
    expect(controller.linkedOf(workspaceTask)).toEqual([])
    // An explicit session bind surfaces exactly its session.
    const sessionTask: TaskRecord = taskWithBind({ kind: 'session', sessionId: 's-1' })
    expect(controller.linkedOf(sessionTask).map(row => row.sessionId)).toEqual(['s-1'])
  })

  it('removeTaskSession keeps a session removed permanently (no resurrection)', () => {
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = false
    sessions.runningById['s-2'] = false
    const wss = workspaces()
    wss.items = [{ id: 'w-a', title: '项目A', sessionIds: ['s-1', 's-2'] }]
    const controller = new BoardController({
      store: new InMemoryTaskStore(),
      exec: new StubExec() as unknown as ExecutionService,
      sessions,
      workspaces: wss,
      now: () => NOW,
      uuid,
    })
    const task = controller.createTask({ title: 't', description: '', prompt: '' })!
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-2' })
    // A manual order is in effect before the removal: dropping s-2 BEFORE s-1
    // persists ['s-2', 's-1'] — the removal must also strip its slot.
    expect(controller.reorderTaskSession(task.id, 's-2', 's-1')).toBe(true)
    controller.hideTaskSession(task.id, 's-1')
    let current = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.sessionsOf(current).map(row => row.sessionId)).toEqual(['s-2'])
    expect(controller.removeTaskSession(task.id, 's-1')).toBe(true)
    // The removal is permanent: it never re-derives, neither in the list nor
    // in linkedOf, and the removed session's own bind is gone with it.
    current = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.sessionsOf(current).map(row => row.sessionId)).toEqual(['s-2'])
    expect(controller.linkedOf(current).map(row => row.sessionId)).toEqual(['s-2'])
    expect(current.removedSessions).toContain('s-1')
    expect(current.hidden).toBeUndefined()
    // The removed session's manual-order slot is gone with it; only s-2's
    // remains. Removing the last ordered session clears the field entirely.
    expect(current.sessionsOrder).toEqual(['s-2'])
    // Re-adding the workspace never resurrects the removed session (folder
    // membership is not derived at all).
    expect(controller.addTaskSource(task.id, { kind: 'workspace', workspaceId: 'w-a' })).toBe(true)
    current = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.sessionsOf(current).map(row => row.sessionId)).toEqual(['s-2'])
    controller.hideTaskSession(task.id, 's-2')
    expect(controller.removeTaskSession(task.id, 's-2')).toBe(true)
    current = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(current.sessionsOrder).toBeUndefined()
  })

  it('reorderTaskSession persists the manual 会话 order and advances updatedAt (sync-merge freshness)', () => {
    let clock = NOW - 5_000
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = false
    sessions.runningById['s-2'] = false
    const wss = workspaces()
    wss.items = [{ id: 'w-x', title: 'W', sessionIds: [] }]
    const controller = new BoardController({
      store: new InMemoryTaskStore(),
      exec: new StubExec() as unknown as ExecutionService,
      sessions,
      workspaces: wss,
      now: () => clock,
      uuid,
    })
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-2' })
    const before = controller.sessionsOf(controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!)
      .map(row => row.sessionId)
    expect(before).toContain('s-1')
    const stampedBefore = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!.updatedAt
    // A later real time for the drag itself.
    clock = NOW
    // Drag s-1 to the END (beforeId undefined) — the persisted order equals
    // the new display order.
    expect(controller.reorderTaskSession(task.id, 's-1', undefined)).toBe(true)
    const after = controller.sessionsOf(controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!)
      .map(row => row.sessionId)
    expect(after).toEqual([...before.filter(id => id !== 's-1'), 's-1'])
    const persisted = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(persisted.sessionsOrder).toEqual(after)
    // A user-intent write: the reorder advances `updatedAt` past the bind
    // stamp, so the sync merge ranks it newer (the two-device order-drift
    // root fix, defense one — defense two is the authorship claim).
    expect(persisted.updatedAt).toBe(NOW)
    expect(persisted.updatedAt).toBeGreaterThan(stampedBefore)
    // The same order on a second drag is a no-op.
    expect(controller.reorderTaskSession(task.id, 's-1', undefined)).toBe(false)
  })

  it('addTaskSource restores a removed session when the session itself is re-dragged (explicit bring-back)', () => {
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = false
    sessions.runningById['s-2'] = false
    const controller = new BoardController({
      store: new InMemoryTaskStore(),
      exec: new StubExec() as unknown as ExecutionService,
      sessions,
      now: () => NOW,
      uuid,
    })
    const task = controller.createTask({ title: 't', description: '', prompt: '' })!
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-2' })
    controller.hideTaskSession(task.id, 's-1')
    expect(controller.removeTaskSession(task.id, 's-1')).toBe(true)
    let current = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.sessionsOf(current).map(row => row.sessionId)).toEqual(['s-2'])
    // Removal stays passive-immune (no workspace re-add resurrects it), but
    // the USER dragging the session back is the restore gesture: it shows
    // again and leaves the removed set.
    expect(controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })).toBe(true)
    current = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.sessionsOf(current).map(row => row.sessionId)).toContain('s-1')
    expect(current.removedSessions ?? []).not.toContain('s-1')
  })

  it('re-adding a workspace bind restores nothing (a folder is not a session subscription)', () => {
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
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-2' })
    controller.hideTaskSession(task.id, 's-1')
    expect(controller.removeTaskSession(task.id, 's-1')).toBe(true)
    // Re-dragging the SAME folder is a pure no-op now: the bind exists and a
    // folder carries no restorable membership (the old same-source re-add
    // restored members — membership is no longer derived at all).
    expect(controller.addTaskSource(task.id, { kind: 'workspace', workspaceId: 'w-a' })).toBe(false)
    const current = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.sessionsOf(current).map(row => row.sessionId)).not.toContain('s-1')
    expect(current.removedSessions).toContain('s-1')
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

  it('passes prompt images through to the sessionMessage face unchanged (official bytes shape)', async () => {
    const seen: Array<{ text: string; images: unknown }> = []
    const { controller } = makeController(new StubExec(), {
      sessionMessage: async (_sessionId, text, images) => {
        seen.push({ text, images })
        return { ok: true as const }
      },
    })
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    const images = [{ mediaType: 'image/png', data: 'aGk=', name: 'a.png' }]
    await expect(controller.steerCommentWithImages(task.id, 's-1', '看图', images)).resolves.toEqual({ ok: true })
    // The wiring receives the temporary-bytes parts as-is (attachmentId is the
    // HOST's business after admission — the board never invents a ref shape).
    expect(seen[0].images).toEqual(images)
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

  it('gates EXECUTION paths on an empty prompt; comments are human words, never gated', async () => {
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
    // Arming 完成后接续 on a blank-prompt card is rejected outright (the
    // editor surfaces the blocked reason — never a silent dead arm).
    expect(controller.setSchedule(task.id, { enabled: true, mode: 'chain' })).toBe(false)
    expect(store.load()[0].schedule).toBeUndefined()
    // Comments (queue) and steer (direct) are the user's own words — they
    // drive the agent in the session and are NEVER gated by the execution
    // prompt (that gate belongs to task execution only).
    const saved = controller.submitSessionComment(task.id, 'linked-7', '帮我把需求整理清楚')
    expect(saved?.comment).toBe('帮我把需求整理清楚')
    await expect(controller.steerComment(task.id, 'linked-7', '先回答我')).resolves.toEqual({ ok: true })
    expect(store.load()[0].executions.length).toBeGreaterThanOrEqual(2)
    // Filling the prompt restores the execution path.
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

  it('a session already running at page load IS recorded (the card follows live reality)', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const seeded = createTask({ title: 'x', description: '', prompt: 'run' }, NOW, 'task-a')
    store.save([{ ...seeded, status: 'review', executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: NOW + 1, result: 'failed', error: undefined }] }])
    const sessions = new FakeSessions()
    // The native session is ALREADY running when the board's first scan
    // happens: the old edge rule only baselined it (the row showed 进行中
    // while the card never moved — the reported bug). The state rule records
    // the live turn and drives the card.
    sessions.setRunning('s-1', true)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    const task = controller.getSnapshot().tasks[0]
    const ext = task.executions[task.executions.length - 1]
    expect(ext.external).toBe(true)
    expect(ext.sessionId).toBe('s-1')
    expect(ext.endedAt).toBeUndefined()
    expect(task.status).toBe('running')
    // Idempotent: later passes never double-record the same run period.
    await flush()
    await flush()
    expect(controller.getSnapshot().tasks[0].executions.filter(run => run.external === true)).toHaveLength(1)
  })

  it('a session idle at page load re-fires nothing (past turns stay past)', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const seeded = createTask({ title: 'x', description: '', prompt: 'run' }, NOW, 'task-a')
    store.save([{ ...seeded, status: 'review', executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: NOW + 1, result: 'succeeded', error: undefined }] }])
    const sessions = new FakeSessions()
    sessions.setRunning('s-1', false)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    await flush()
    expect(controller.getSnapshot().tasks[0].executions.some(run => run.external === true)).toBe(false)
    expect(controller.getSnapshot().tasks[0].status).toBe('review')
  })

  it('a lane veto that lifts mid-turn does not eat the running period (coverage never consumes)', async () => {
    // The "card never lights" root: the detector used to consume the run
    // period on a lane veto, so when the veto lifted (the blocking round
    // settled) with the session STILL working the same turn, no second edge
    // ever came. Coverage vetoes must not consume — only board-owned turns
    // (identity) do.
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const seeded = createTask({ title: 'x', description: '', prompt: 'run' }, NOW, 'task-a')
    store.save([{
      ...seeded,
      status: 'running',
      binds: [{ kind: 'session', sessionId: 's-1' }],
      executions: [
        { id: 'c1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined, comment: 'injected', injectedAt: NOW },
      ],
    }])
    const sessions = new FakeSessions()
    sessions.setRunning('s-1', true)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    await flush()
    // Lane held by the injected comment: no external round yet (correct veto).
    expect(controller.getSnapshot().tasks[0].executions.some(run => run.external === true)).toBe(false)
    // The blocking round settles while the session keeps working the SAME
    // native turn (no idle edge anywhere).
    stub.reconcileResult = { kind: 'settled', taskId: 'task-a', executionId: 'c1', outcome: 'succeeded' }
    sessions.setRunning('s-1', true)
    await flush()
    await flush()
    expect(controller.getSnapshot().tasks[0].executions.find(round => round.id === 'c1')?.endedAt).toBeDefined()
    expect(controller.getSnapshot().tasks[0].executions.some(run => run.external === true)).toBe(false)
    // Veto lifted mid-turn: the native turn fires now, exactly once.
    sessions.setRunning('s-1', true)
    await flush()
    await flush()
    const after = controller.getSnapshot().tasks[0]
    const externals = after.executions.filter(run => run.external === true)
    expect(externals).toHaveLength(1)
    expect(externals[0]?.sessionId).toBe('s-1')
    await flush()
    await flush()
    expect(controller.getSnapshot().tasks[0].executions.filter(run => run.external === true)).toHaveLength(1)
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
    // Past the grace → the spurious round is cancelled (card back to review:
    // the prior failed run already awaits the human gate — noise must never
    // swallow it back to todo; see settleColumnOf).
    clock = NOW + 100_000
    sessions.setRunning('s-1', false)
    await flush()
    await flush()
    const cancelled = controller.getSnapshot().tasks[0]
    expect(cancelled.status).toBe('review')
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

describe('recordNativeTurn (live turn channel)', () => {
  /** A controller with one bound session, seeded idle. */
  async function boundHarness() {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const sessions = new FakeSessions()
    sessions.setRunning('s-1', false)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })
    await flush()
    return { controller, sessions, stub }
  }

  it('a live user/message records the external round with text + anchor and drives the card', async () => {
    const { controller } = await boundHarness()
    controller.recordNativeTurn('s-1', { text: '帮我重构', hasImage: false, anchor: 42 })
    const task = controller.getSnapshot().tasks[0]
    const ext = task.executions[task.executions.length - 1]
    expect(ext.external).toBe(true)
    expect(ext.comment).toBe('帮我重构')
    expect(ext.anchor).toBe(42)
    expect(task.status).toBe('running')
  })

  it('the same anchor never records twice (live frame + reconcile backstop)', async () => {
    const { controller, sessions } = await boundHarness()
    controller.recordNativeTurn('s-1', { text: '同一轮', hasImage: false, anchor: 7 })
    // The backstop now sees the session running (the frame baselined it) —
    // even a second frame for the same seq must not double-record.
    sessions.setRunning('s-1', true)
    await flush()
    controller.recordNativeTurn('s-1', { text: '同一轮', hasImage: false, anchor: 7 })
    await flush()
    const task = controller.getSnapshot().tasks[0]
    expect(task.executions.filter(run => run.external === true)).toHaveLength(1)
  })

  it('a native chat is still recorded while a comment for that session is merely QUEUED, and the comment then waits for it', async () => {
    // The user's question: "我在工作区直接发消息，它也会同步到评论区，那时候
    // 它就是在运行了" — that live turn must never be swallowed by a comment
    // that is only sitting in the queue (a saved comment is not a running
    // turn), and once the native turn IS running, the queued comment waits
    // its turn in that same lane. One judgment, one order, no lost activity.
    const { controller, sessions, stub } = await boundHarness()
    const task = controller.getSnapshot().tasks[0]
    const queued = controller.submitSessionComment(task.id, 's-1', '排队里的那句')!
    expect(queued).toBeDefined()
    expect(stub.commentCalls).toHaveLength(0) // cruise off: saved, nothing injected
    // The user chats in the native UI while the comment is still queued.
    controller.recordNativeTurn('s-1', { text: '工作区里直接说的话', hasImage: false, anchor: 11 })
    const running = controller.getSnapshot().tasks[0]
    const ext = running.executions[running.executions.length - 1]
    expect(ext.external).toBe(true)
    expect(ext.comment).toBe('工作区里直接说的话')
    expect(running.status).toBe('running')
    // Cruise on: the queued comment must NOT jump ahead of the live turn.
    controller.setCruiseEnabled(true)
    expect(stub.commentCalls).toHaveLength(0)
    // The native turn finishes (the host list flips) → the lane is free → the
    // comment goes out, in order, after the turn it waited behind.
    stub.reconcileResult = { kind: 'settled', taskId: task.id, executionId: ext.id, outcome: 'succeeded' }
    sessions.setRunning('s-1', false)
    await flush()
    await flush()
    expect(stub.commentCalls.map(call => call.text)).toEqual(['排队里的那句'])
  })

  it('a round left without a session by a page death is released, not wedged forever', async () => {
    // Reload window: the run was launched but its `started` never landed.
    // Under per-session lanes an unbound round BEHIND the newest row is
    // invisible to the history sweep (no session to probe), so without a
    // verdict it would hold a budget slot, keep the card 进行中 and refuse
    // every re-run and drop — permanently.
    let clock = NOW
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const seeded = createTask({ title: 'x', description: '', prompt: 'run' }, NOW, 'task-a')
    store.save([{
      ...seeded,
      status: 'running',
      executions: [
        { id: 'u1', sessionId: undefined, startedAt: NOW, endedAt: undefined, result: undefined, error: undefined },
        { id: 'e2', sessionId: 's-2', startedAt: NOW + 1, endedAt: NOW + 2, result: 'succeeded' as const, error: undefined },
      ],
    }])
    const sessions = new FakeSessions()
    sessions.setRunning('s-2', false)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService, sessions,
      now: () => clock, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    // Still inside the deadline: untouched (a slow connect is not a zombie).
    expect(controller.getSnapshot().tasks[0].status).toBe('running')
    clock = NOW + 4 * 60_000
    sessions.setRunning('s-2', false) // any list change drives a reconcile pass
    await flush()
    await flush()
    const after = controller.getSnapshot().tasks[0]
    const released = after.executions.find(round => round.id === 'u1')
    expect(released?.endedAt).toBeDefined()
    expect(released?.result).toBe('cancelled')
    expect(after.status).not.toBe('running')
    // The card can run again: the slot came back.
    await controller.runTask('task-a')
    expect(stub.runCalls).toHaveLength(1)
  })

  it('a turn on a session with an open board round is the board\'s own — not recorded, period consumed', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const sessions = new FakeSessions()
    sessions.setRunning('s-1', true)
    // Seed a task with an OPEN board round on the session (injected, running):
    // the native activity IS the board's own turn.
    const seeded = createTask({ title: 'x', description: '', prompt: 'run' }, NOW, 'task-a')
    store.save([{
      ...seeded,
      status: 'running',
      executions: [{ id: 'e-open', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
    }])
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    // The state backstop sees the session running but the board round is open
    // — nothing to record.
    expect(controller.getSnapshot().tasks[0].executions.some(run => run.external === true)).toBe(false)
    // The live echo of the board's OWN injection must not add an external round.
    controller.recordNativeTurn('s-1', { text: '驱动一下', hasImage: false, anchor: 99 })
    const after = controller.getSnapshot().tasks[0]
    expect(after.executions.some(run => run.external === true)).toBe(false)
    expect(after.executions).toHaveLength(1)
    void stub
  })

  it('a refine-session turn records a refine round that never moves the column', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const sessions = new FakeSessions()
    sessions.setRunning('s-refine', false)
    // Seed a task whose refine session is bound directly (the refine flow's
    // persisted shape): the related set marks it refine.
    const seeded = createTask({ title: 'x', description: '', prompt: 'run' }, NOW, 'task-r')
    store.save([{ ...seeded, status: 'review', refineSessionId: 's-refine' }])
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    controller.recordNativeTurn('s-refine', { text: '补充需求', hasImage: false, anchor: 5 })
    const after = controller.getSnapshot().tasks[0]
    const ext = after.executions[after.executions.length - 1]
    expect(ext.external).toBe(true)
    expect(ext.refine).toBe(true)
    // A refine round is preparation: the card keeps its column.
    expect(after.status).toBe('review')
  })

  it('a non-engine replica records nothing (the engine records once, sync carries it)', async () => {
    const { controller } = await boundHarness()
    controller.setEngine(false)
    controller.recordNativeTurn('s-1', { text: ' viewer 端不记', hasImage: false, anchor: 3 })
    const task = controller.getSnapshot().tasks[0]
    expect(task.executions.some(run => run.external === true)).toBe(false)
  })

  it('two tasks sharing one bound session each get their own round', async () => {
    const { controller } = await boundHarness()
    const second = controller.createTask({ title: 'y', description: '', prompt: 'run' })!
    controller.addTaskSource(second.id, { kind: 'session', sessionId: 's-1' })
    await flush()
    controller.recordNativeTurn('s-1', { text: '共同会话', hasImage: false, anchor: 11 })
    const tasks = controller.getSnapshot().tasks
    expect(tasks.every(task => task.executions.some(run => run.external === true && run.anchor === 11))).toBe(true)
    expect(tasks.every(task => task.status === 'running')).toBe(true)
  })

  it('an activity wake records a turn the status edge cannot see (started AND finished between passes)', async () => {
    // The 0.1.5 wake channel: the host fires per user message; the wake
    // carries no text, so the reconcile reads the tail for it. The session
    // NEVER reads running here — the wake alone must record the turn.
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const sessions = new FakeSessions()
    sessions.setRunning('s-1', false)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
      transcript: async () => ({
        events: [{ type: 'user/message', seq: 31, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '原生里说的话' }] } }],
      }) as never,
    })
    controller.start()
    await flush()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })
    await flush()
    // A stale (non-advancing) wake never re-schedules, never records.
    controller.recordActivityWake('s-1', 100)
    controller.recordActivityWake('s-1', 100)
    await flush()
    await flush()
    const after = controller.getSnapshot().tasks[0]
    const ext = after.executions.filter(run => run.external === true)
    expect(ext).toHaveLength(1)
    expect(ext[0].comment).toBe('原生里说的话')
    expect(ext[0].anchor).toBe(31)
    expect(after.status).toBe('running')
  })

  it('a wake never doubles a turn the state rule already recorded (anchor dedup)', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const sessions = new FakeSessions()
    sessions.setRunning('s-1', false)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
      transcript: async () => ({
        events: [{ type: 'user/message', seq: 31, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '同一轮' }] } }],
      }) as never,
    })
    controller.start()
    await flush()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })
    await flush()
    controller.recordActivityWake('s-1', 100)
    sessions.setRunning('s-1', true)
    await flush()
    await flush()
    const after = controller.getSnapshot().tasks[0]
    expect(after.executions.filter(run => run.external === true)).toHaveLength(1)
  })

  it('a wake on an unrelated session records nothing', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const sessions = new FakeSessions()
    sessions.setRunning('s-1', false)
    sessions.setRunning('s-stranger', false)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })
    await flush()
    controller.recordActivityWake('s-stranger', 300)
    await flush()
    await flush()
    expect(controller.getSnapshot().tasks[0].executions.some(run => run.external === true)).toBe(false)
  })

  it('a wake on a non-engine replica records nothing', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const sessions = new FakeSessions()
    sessions.setRunning('s-1', false)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })
    await flush()
    controller.setEngine(false)
    controller.recordActivityWake('s-1', 200)
    const after = controller.getSnapshot().tasks[0]
    expect(after.executions.some(run => run.external === true)).toBe(false)
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

describe('user-intent writes carry freshness (userEdit funnel)', () => {
  function funnelHarness() {
    let clock = NOW
    const store = new InMemoryTaskStore()
    seedTask(store)
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = false
    sessions.runningById['s-2'] = false
    const controller = new BoardController({
      store,
      exec: new StubExec() as unknown as ExecutionService,
      sessions,
      now: () => clock,
      uuid,
    })
    controller.start()
    return {
      controller,
      stamp: () => controller.getSnapshot().tasks[0].updatedAt,
      advance: () => { clock += 1000 },
    }
  }

  it('hide / unhide-one / unhide-all each advance updatedAt', () => {
    const { controller, stamp, advance } = funnelHarness()
    advance()
    const t0 = stamp()
    controller.hideTaskSession('task-a', 's-1')
    expect(stamp()).toBeGreaterThan(t0)
    advance()
    const t1 = stamp()
    controller.unhideTaskSession('task-a', 's-1')
    expect(stamp()).toBeGreaterThan(t1)
    controller.hideTaskSession('task-a', 's-2')
    advance()
    const t2 = stamp()
    controller.unhideTaskSessions('task-a')
    expect(stamp()).toBeGreaterThan(t2)
  })

  it('hiding an already-hidden session is a no-op (no stamp churn)', () => {
    const { controller, stamp } = funnelHarness()
    controller.hideTaskSession('task-a', 's-1')
    const before = stamp()
    controller.hideTaskSession('task-a', 's-1')
    expect(stamp()).toBe(before)
  })

  it('binding a source and RESTORING a removed one both advance updatedAt (the swallowed-restore bug)', () => {
    const { controller, stamp, advance } = funnelHarness()
    advance()
    controller.addTaskSource('task-a', { kind: 'session', sessionId: 's-1' })
    controller.addTaskSource('task-a', { kind: 'session', sessionId: 's-2' })
    // The real removal path: hide, then 删除 from the hidden tray — the bind
    // stays (two binds), s-1 lands in removedSessions.
    controller.hideTaskSession('task-a', 's-1')
    expect(controller.removeTaskSession('task-a', 's-1')).toBe(true)
    advance()
    const before = stamp()
    // Re-dragging s-1 hits the RESTORE branch (the bind is still there): the
    // old code cleared removedSessions without a stamp — sync swallowed it.
    expect(controller.addTaskSource('task-a', { kind: 'session', sessionId: 's-1' })).toBe(true)
    expect(stamp()).toBeGreaterThan(before)
    expect(controller.getSnapshot().tasks[0].removedSessions ?? []).not.toContain('s-1')
  })

  it('session-rule CRUD all advance updatedAt (the "toggled off but still runs" class)', () => {
    const { controller, stamp, advance } = funnelHarness()
    advance()
    const t0 = stamp()
    const rule = controller.createSessionRule('task-a', { sessionId: 's-1', instruction: '继续', cron: '0 * * * *', send: 'queue' })
    expect(rule).toBeDefined()
    expect(stamp()).toBeGreaterThan(t0)
    advance()
    const t1 = stamp()
    expect(controller.updateSessionRule('task-a', rule!.id, { instruction: '改成这个' })).toBe(true)
    expect(stamp()).toBeGreaterThan(t1)
    advance()
    const t2 = stamp()
    controller.toggleSessionRule('task-a', rule!.id, false)
    expect(stamp()).toBeGreaterThan(t2)
    expect(controller.getSnapshot().tasks[0].rules?.[0].enabled).toBe(false)
    advance()
    const t3 = stamp()
    controller.deleteSessionRule('task-a', rule!.id)
    expect(stamp()).toBeGreaterThan(t3)
  })

  it('read-state writes do NOT advance updatedAt (viewedAt is not an edit)', () => {
    const { controller, advance } = funnelHarness()
    advance()
    controller.openTask('task-a')
    const task = controller.getSnapshot().tasks.find(candidate => candidate.id === 'task-a')!
    expect(task.viewedAt).toBe(NOW + 1000)
    expect(task.updatedAt).toBe(NOW)
  })

  it('a shifted sibling carries the freshness stamp too (order-drift class)', () => {
    let clock = NOW
    const store = new InMemoryTaskStore()
    const a = createTask({ title: 'A', description: '', prompt: 'p', status: 'todo' }, NOW, 't-a')
    const b = createTask({ title: 'B', description: '', prompt: 'p', status: 'todo' }, NOW, 't-b')
    store.save([{ ...a, order: 0 }, { ...b, order: 1 }])
    const controller = new BoardController({
      store, exec: new StubExec() as unknown as ExecutionService,
      sessions: new FakeSessions(), now: () => clock, uuid,
    })
    controller.start()
    clock = NOW + 1000
    // b moves before a: a's order shifts — the shifted sibling must be stamped
    // too, or its new position loses every merge on every other replica.
    controller.moveTask('t-b', 'todo', 't-a')
    const tasks = controller.getSnapshot().tasks
    expect(tasks.find(candidate => candidate.id === 't-b')!.updatedAt).toBe(NOW + 1000)
    expect(tasks.find(candidate => candidate.id === 't-a')!.updatedAt).toBe(NOW + 1000)
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

  it('a session born running inside a bound workspace is NOT recorded (the flood is sealed); an explicit bind IS', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const sessions = new FakeSessions()
    const wss = new FakeWorkspaces()
    // The workspace is bound BEFORE the new session exists.
    wss.items = [{ id: 'w-a', title: '工作区A', sessionIds: [] }]
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, workspaces: wss, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    const task = controller.createBoundTask({ kind: 'workspace', workspaceId: 'w-a' }, { title: 'w', description: '', prompt: '' })!
    await flush()
    // The user creates a new session in the folder and chats: the folder is a
    // source association, NOT a conversation subscription — the card stays
    // untouched (this was the "主界面新建会话突然进任务卡片" bug).
    wss.items = [{ id: 'w-a', title: '工作区A', sessionIds: ['s-new'] }]
    sessions.setRunning('s-new', true)
    wss.notify()
    await flush()
    await flush()
    let row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.status).not.toBe('running')
    expect(row.executions.filter(round => round.external === true)).toHaveLength(0)
    // The same session EXPLICITLY bound (the user's own gesture) keeps the
    // 首聊根因 fix: born running with no observable flip is still recorded
    // (the add itself triggers the instant sync).
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-new' })
    await flush()
    await flush()
    row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    const ext = row.executions[row.executions.length - 1]
    expect(ext.external).toBe(true)
    expect(ext.sessionId).toBe('s-new')
    expect(ext.endedAt).toBeUndefined()
    // Exactly one round: the detection is idempotent.
    expect(row.executions.filter(round => round.external === true)).toHaveLength(1)
  })

  it('a snapshotted workspace member rides the card live (snapshot binds are explicit); later births do not join', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const sessions = new FakeSessions()
    const wss = new FakeWorkspaces()
    wss.items = [{ id: 'w-a', title: '工作区A', sessionIds: ['s-member'] }]
    sessions.setRunning('s-member', false)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, workspaces: wss, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    const task = controller.createBoundTask({ kind: 'workspace', workspaceId: 'w-a' }, { title: 'w', description: '', prompt: '' })!
    await flush()
    // The folder member joined as an explicit bind at creation (ownership
    // snapshot) — idle member, idle card.
    expect(task.binds).toEqual([
      { kind: 'workspace', workspaceId: 'w-a' },
      { kind: 'session', sessionId: 's-member' },
    ])
    expect(controller.liveStateOf(task.id)).toBe('idle')
    // The member starts chattering natively: the card follows (an explicit
    // bind rides the native truth — this is the requested "带进卡片" semantics).
    sessions.setRunning('s-member', true)
    wss.notify()
    await flush()
    await flush()
    expect(controller.liveStateOf(task.id)).toBe('running')
    // A session born AFTER the drop never joins on its own (the flood stays
    // sealed for newcomers).
    sessions.setRunning('s-late', false)
    sessions.setInfo('s-late', { workspaceId: 'w-a' })
    wss.notify()
    await flush()
    await flush()
    expect(task.binds).toHaveLength(2)
    // Detach the member again and the card goes quiet (binds are the truth).
    controller.removeTaskSession(task.id, 's-member')
    await flush()
    await flush()
    expect(controller.liveStateOf(task.id)).toBe('idle')
  })

  it('deleting a session while a workspace bind stays does NOT keep driving the card (removed gate)', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const sessions = new FakeSessions()
    const wss = new FakeWorkspaces()
    wss.items = [{ id: 'w-a', title: '工作区A', sessionIds: ['s-x'] }]
    sessions.setRunning('s-x', true)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, workspaces: wss, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    // The user's scenario: the whole workspace folder is bound, AND a session
    // inside it is explicitly bound (so it shows as a row and rides live state).
    const task = controller.createBoundTask({ kind: 'workspace', workspaceId: 'w-a' }, { title: 'w', description: '', prompt: '' })!
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-x' })
    await flush()
    await flush()
    expect(controller.liveStateOf(task.id)).toBe('running')
    // Delete the session from the card (hidden-tray 删除). The workspace bind
    // keeps the session bind from being unbound — but removedSessions is now
    // the authoritative gate, so the running session must NOT move the card.
    expect(controller.removeTaskSession(task.id, 's-x')).toBe(true)
    await flush()
    await flush()
    expect(controller.liveStateOf(task.id)).toBe('idle')
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.sessionsOf(row).map(r => r.sessionId)).not.toContain('s-x')
    // No external round is recorded for the deleted session.
    expect(row.executions.filter(round => round.sessionId === 's-x')).toHaveLength(0)
    // The deleted session leaves the related set → it is re-offerable in the
    // add-session picker (删除 = 可再拖回/再选回).
    expect(controller.relatedSessionIdSet(row).has('s-x')).toBe(false)
  })

  it('createTaskSession creates a fresh session through the exec service and binds it (新建会话)', async () => {
    const stub = new StubExec() as StubExec & {
      createSession?: (config: unknown) => Promise<{ ok: true; sessionId: string } | { ok: false; error: string }>
    }
    stub.createSession = async config => {
      expect(config).toEqual({ workspaceId: 'ws-1', agentPreset: 'butler' })
      return { ok: true as const, sessionId: 's-created' }
    }
    const { controller, store } = makeController(stub as unknown as StubExec)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    const result = await controller.createTaskSession(task.id, { workspaceId: 'ws-1', agentPreset: 'butler' })
    expect(result).toEqual({ ok: true, sessionId: 's-created' })
    // The created session joined the task's source set (persisted, additive).
    expect(store.load()[0].binds).toEqual([{ kind: 'session', sessionId: 's-created' }])
    // No execution round was opened (a session is not a run).
    expect(store.load()[0].executions).toHaveLength(0)
  })

  it('createTaskSession surfaces a creation failure without touching the task', async () => {
    const stub = new StubExec() as StubExec & {
      createSession?: () => Promise<{ ok: true; sessionId: string } | { ok: false; error: string }>
    }
    stub.createSession = async () => ({ ok: false as const, error: 'no workspace' })
    const { controller, store } = makeController(stub as unknown as StubExec)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    const result = await controller.createTaskSession(task.id, {})
    expect(result).toEqual({ ok: false, error: 'no workspace' })
    expect(store.load()[0].binds).toBeUndefined()
  })

  it('createTaskSession reports unavailable when the exec service offers no createSession face', async () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    const result = await controller.createTaskSession(task.id, {})
    expect(result).toEqual({ ok: false, error: 'session creation is unavailable' })
    expect(store.load()[0].binds).toBeUndefined()
  })

  it('createTaskSession applies a filled title through the official rename (pinned against auto naming)', async () => {
    const renames: Array<[string, string]> = []
    const stub = new StubExec() as StubExec & {
      createSession?: (config: Record<string, unknown>) => Promise<{ ok: true; sessionId: string } | { ok: false; error: string }>
      renameSession?: (sessionId: string, title: string) => Promise<{ ok: true } | { ok: false; error: string }>
    }
    stub.createSession = async config => {
      // The launch config never carries the title (it is not a run field).
      expect(config.title).toBeUndefined()
      return { ok: true as const, sessionId: 's-titled' }
    }
    stub.renameSession = async (sessionId, title) => {
      renames.push([sessionId, title])
      return { ok: true as const }
    }
    const { controller, store } = makeController(stub as unknown as StubExec)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    const result = await controller.createTaskSession(task.id, { workspaceId: 'ws-1', title: ' 酒标第二轮 ' })
    expect(result).toEqual({ ok: true, sessionId: 's-titled' })
    expect(renames).toEqual([['s-titled', '酒标第二轮']])
    expect(store.load()[0].binds).toEqual([{ kind: 'session', sessionId: 's-titled' }])
  })

  it('createTaskSession sends NOTHING when the title is blank (auto naming stays intact)', async () => {
    let renameCalls = 0
    const stub = new StubExec() as StubExec & {
      createSession?: () => Promise<{ ok: true; sessionId: string } | { ok: false; error: string }>
      renameSession?: () => Promise<{ ok: true } | { ok: false; error: string }>
    }
    stub.createSession = async () => ({ ok: true as const, sessionId: 's-auto' })
    stub.renameSession = async () => { renameCalls += 1; return { ok: true as const } }
    const { controller } = makeController(stub as unknown as StubExec)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    const result = await controller.createTaskSession(task.id, { title: '   ' })
    expect(result).toEqual({ ok: true, sessionId: 's-auto' })
    expect(renameCalls).toBe(0)
  })

  it('createTaskSession surfaces a title failure as a partial success (session stays bound)', async () => {
    const stub = new StubExec() as StubExec & {
      createSession?: () => Promise<{ ok: true; sessionId: string } | { ok: false; error: string }>
      renameSession?: () => Promise<{ ok: true } | { ok: false; error: string }>
    }
    stub.createSession = async () => ({ ok: true as const, sessionId: 's-part' })
    stub.renameSession = async () => ({ ok: false as const, error: 'title-invalid' })
    const { controller, store } = makeController(stub as unknown as StubExec)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    const result = await controller.createTaskSession(task.id, { title: '名字' })
    expect(result).toMatchObject({ ok: true, sessionId: 's-part' })
    expect((result as { titleError?: string }).titleError).toBe('title-invalid')
    expect(store.load()[0].binds).toEqual([{ kind: 'session', sessionId: 's-part' }])
  })

  it('renameTaskSession renames a related session through the exec face', async () => {
    const renames: Array<[string, string]> = []
    const stub = new StubExec() as StubExec & {
      renameSession?: (sessionId: string, title: string) => Promise<{ ok: true } | { ok: false; error: string }>
    }
    stub.renameSession = async (sessionId, title) => {
      renames.push([sessionId, title])
      return { ok: true as const }
    }
    const { controller } = makeController(stub as unknown as StubExec)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })
    expect(await controller.renameTaskSession(task.id, 's-1', ' 新名 ')).toEqual({ ok: true })
    expect(renames).toEqual([['s-1', '新名']])
  })

  it('renameTaskSession refuses sessions outside the task, blank titles, and unknown tasks', async () => {
    const stub = new StubExec() as StubExec & {
      renameSession?: () => Promise<{ ok: true } | { ok: false; error: string }>
    }
    stub.renameSession = async () => ({ ok: true as const })
    const { controller } = makeController(stub as unknown as StubExec)
    const task = controller.createTask({ title: 'x', description: '', prompt: 'run' })!
    controller.addTaskSource(task.id, { kind: 'session', sessionId: 's-1' })
    expect(await controller.renameTaskSession(task.id, 's-other', '名')).toMatchObject({ ok: false })
    expect(await controller.renameTaskSession(task.id, 's-1', '   ')).toMatchObject({ ok: false })
    expect(await controller.renameTaskSession('nope', 's-1', '名')).toMatchObject({ ok: false })
  })
})

describe('session automation rules (给会话定时发指令)', () => {
  function ruleHarness(sessionIds: string[], faces: {
    sessionMessage?: (sessionId: string, text: string, images?: unknown, mode?: 'queue' | 'steer') => Promise<{ ok: true } | { ok: false; error: string }>
    sessionCommand?: (sessionId: string, line: string) => Promise<{ ok: true; matched: boolean } | { ok: false; error: string }>
  }): { controller: BoardController; sessions: FakeSessions; stub: StubExec } {
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
    return { controller, sessions, stub }
  }

  it('creates a rule with a due instant and rejects an unparseable cron', () => {
    const { controller } = ruleHarness(['s-a'], {})
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    const rule = controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'nightly check', cron: '0 0 * * *', send: 'queue' })
    expect(rule).toBeDefined()
    expect(rule!.nextAt).toBeGreaterThan(NOW)
    expect(controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'x', cron: 'not a cron', send: 'queue' })).toBeUndefined()
  })

  it('a session gets AT MOST ONE rule: a second rule is rejected outright — one definition, edited, never a stack', () => {
    const { controller } = ruleHarness(['s-a', 's-b'], {})
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    const first = controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'one', cron: '* * * * *', send: 'queue' })
    expect(first).toBeDefined()
    // The same session again — any trigger/content — is rejected.
    expect(controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'two', cron: '0 0 * * *', send: 'steer' })).toBeUndefined()
    expect(controller.createSessionRule(task.id, { sessionId: 's-a', instruction: '', cron: '', trigger: 'on-complete', usePrompt: true, send: 'steer' })).toBeUndefined()
    expect(task.rules ?? []).toHaveLength(0) // the ORIGINAL snapshot was never mutated
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.rules).toHaveLength(1)
    // A DIFFERENT session is free to automate its own.
    expect(controller.createSessionRule(task.id, { sessionId: 's-b', instruction: 'beside', cron: '* * * * *', send: 'queue' })).toBeDefined()
    expect(controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!.rules).toHaveLength(2)
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
    const rolled = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!.rules![0].nextAt!
    await controller.tickSessionRules(rolled - 1000)
    expect(sent).toHaveLength(1)
    await controller.tickSessionRules(rolled + 1000)
    expect(sent).toHaveLength(2)
  })

  it('a queue-mode rule rides the AUTOMATION lane: injected at once, never direct, never cruise-gated', async () => {
    const sent: Array<[string, string]> = []
    const { controller, stub } = ruleHarness(['s-a'], { sessionMessage: async (sessionId, text) => { sent.push([sessionId, text]); return { ok: true as const } } })
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'hello', cron: '* * * * *', send: 'queue' })!
    await controller.tickSessionRules(NOW + 120_000)
    expect(sent).toHaveLength(0) // never sent directly
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    const queued = row.executions.find(round => round.comment === 'hello')
    expect(queued?.comment).toBe('hello')
    expect(queued?.direct).toBeUndefined()
    // The scheduled instruction is automation: it rides the own lane and is
    // never left waiting for the board cruise ("定时发指令却没有任何反应" 的
    // 根因就是旧版把排队规则轮当作普通留言、巡航一关就永远等)。
    expect(queued?.injectedAt).toBe(NOW)
    expect(stub.commentCalls.map(call => call.text)).toEqual(['hello'])
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

  it('an ON-COMPLETE rule fires at a PLAIN RUN settle (queue mode) — its OWN lane, never the cron tick', async () => {
    const { controller, stub } = ruleHarness(['s-a'], {})
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'hello', cron: '', trigger: 'on-complete', send: 'queue' })!
    // The minute heartbeat never touches an on-complete rule (no due slot).
    await controller.tickSessionRules(NOW + 120_000)
    let row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.executions.some(round => round.comment === 'hello')).toBe(false)
    // A plain run settles → the rule's OWN round is recorded and injected:
    // the rule's turn flows in its own lane and never waits for the board
    // cruise (a manually saved comment would).
    await controller.runTask(task.id)
    stub.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: stub.runCalls[0].executionId, outcome: 'succeeded' })
    await flush()
    row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    const round = row.executions.find(candidate => candidate.comment === 'hello')
    expect(round?.comment).toBe('hello')
    expect(round?.ruleId).toBeDefined() // a rule's own turn — the loop marker
    expect(round?.injectedAt).toBe(NOW) // injected by its own lane
    expect(row.rules?.[0].lastAt).toBe(NOW)
    const call = stub.commentCalls.find(candidate => candidate.text === 'hello')
    expect(call).toBeDefined()
    // 完成后续跑 = 永续循环: the rule round's SUCCEEDED settle re-fires the
    // same rule — one round per cycle; failure/cancel never re-fires (no
    // error storm), and a user comment (no ruleId) never triggers.
    call!.fire({ kind: 'settled', taskId: task.id, executionId: call!.executionId, outcome: 'succeeded' })
    await flush()
    row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.executions.filter(candidate => candidate.comment === 'hello')).toHaveLength(2)
    expect(stub.commentCalls.filter(candidate => candidate.text === 'hello')).toHaveLength(2)
    // A FAILED rule round ends the loop: the next cycle is not fired.
    const second = stub.commentCalls.find(candidate => candidate.text === 'hello' && candidate !== call)!
    second.fire({ kind: 'settled', taskId: task.id, executionId: second.executionId, outcome: 'failed' })
    await flush()
    row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.executions.filter(candidate => candidate.comment === 'hello')).toHaveLength(2)
    expect(stub.commentCalls.filter(candidate => candidate.text === 'hello')).toHaveLength(2)
  })

  it('an ON-COMPLETE steer rule rides the lane with priority: exactly one observable round per fire', async () => {
    const { controller, stub } = ruleHarness(['s-a'], {})
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    // 'steer' on an on-complete rule = the rule's round takes lane priority
    // (插话跳过排队等待) — still ONE observable round per fire: the loop
    // needs the observable settle, so it always rides the comment machinery,
    // never a raw direct message and never a double launch.
    controller.createSessionRule(task.id, { sessionId: 's-a', instruction: '收尾提示', cron: '', trigger: 'on-complete', send: 'steer' })!
    await controller.runTask(task.id)
    stub.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: stub.runCalls[0].executionId, outcome: 'succeeded' })
    await flush()
    expect(stub.commentCalls.map(call => call.text)).toEqual(['收尾提示'])
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    const round = row.executions.find(candidate => candidate.comment === '收尾提示')
    expect(round?.injectedAt).toBe(NOW)
    expect(round?.direct).toBeUndefined()
    expect(row.rules?.[0].lastAt).toBe(NOW)
  })

  it('an ON-COMPLETE rule respects enabled/present; a usePrompt rule is blocked on an empty prompt', async () => {
    const sent: Array<[string, string]> = []
    const { controller } = ruleHarness(['s-a'], { sessionMessage: async (sessionId, text) => { sent.push([sessionId, text]); return { ok: true as const } } })
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    const off = controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'a', cron: '', trigger: 'on-complete', send: 'steer' })!
    controller.toggleSessionRule(task.id, off.id, false)
    await controller.fireOnCompleteRules(task.id)
    expect(sent).toHaveLength(0) // disabled
    const gone = controller.createSessionRule(task.id, { sessionId: 's-gone', instruction: 'b', cron: '', trigger: 'on-complete', send: 'steer' })!
    void gone
    await controller.fireOnCompleteRules(task.id)
    expect(sent).toHaveLength(0) // session absent
    // A usePrompt rule has NOTHING to send while the task prompt is empty
    // (blocked) — a custom rule on the same empty-prompt task would fire.
    const blank = controller.createTask({ title: 'b', description: '', prompt: '', status: 'todo' })!
    controller.createSessionRule(blank.id, { sessionId: 's-a', instruction: '', cron: '', trigger: 'on-complete', usePrompt: true, send: 'steer' })!
    await controller.fireOnCompleteRules(blank.id)
    expect(sent).toHaveLength(0) // blocked: nothing to send
  })

  it('a RECONCILED plain-run settle fires on-complete rules (恢复/对账结算也算完成)', async () => {
    const stub = new StubExec()
    stub.reconcileResult = { kind: 'settled', taskId: 'task-a', executionId: 'e1', outcome: 'succeeded' }
    const store = new InMemoryTaskStore()
    const task = seedTask(store, { id: 'task-a', prompt: 'run' })
    // A leftover plain run from a previous page — settled by reconcile, never
    // by the live watch: "任务完成了一次，on-complete 规则却没有任何反应" 的
    // 根因（reconcile 路径曾直接 settle，不走 on-complete 钩子）。
    store.save([{
      ...task,
      status: 'running',
      rules: [{ id: 'r1', sessionId: 's-a', instruction: 'hi', cron: '', trigger: 'on-complete', send: 'queue', enabled: true }],
      executions: [{ id: 'e1', sessionId: 's-a', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
    }])
    const sessions = new FakeSessions()
    sessions.setRunning('s-a', false) // known to the list; the turn already finished
    const reloaded = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    reloaded.start()
    await flush()
    const row = reloaded.getSnapshot().tasks.find(candidate => candidate.id === 'task-a')!
    // The plain run settled AND the rule round fired + injected by its lane:
    // the task is running again (its rule's turn is now the open round).
    expect(row.executions.find(round => round.id === 'e1')?.result).toBe('succeeded')
    const fired = row.executions.find(round => round.ruleId === 'r1')
    expect(fired?.comment).toBe('hi')
    expect(fired?.injectedAt).toBe(NOW)
    expect(stub.commentCalls.map(call => call.text)).toEqual(['hi'])
    expect(row.rules?.[0].lastAt).toBe(NOW)
  })

  it('many rules due at the same completion: each session is its own lane, the budget is the throttle', async () => {
    const { controller, stub } = ruleHarness(['s-a', 's-b', 's-c'], {})
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'aa', cron: '', trigger: 'on-complete', send: 'queue' })!
    controller.createSessionRule(task.id, { sessionId: 's-b', instruction: 'bb', cron: '', trigger: 'on-complete', send: 'queue' })!
    controller.createSessionRule(task.id, { sessionId: 's-c', instruction: 'cc', cron: '', trigger: 'on-complete', send: 'steer' })!
    await controller.runTask(task.id)
    stub.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: stub.runCalls[0].executionId, outcome: 'succeeded' })
    await flush()
    // THREE rules due at once, on THREE sessions: the steer rule goes out
    // immediately (a real 插话) and the two queue rules go with it — different
    // conversations, and the budget (default 5) has room. Serializing them
    // behind one another was the same per-card lane the user rejected for
    // manual comments; the throttle is the number the user set, not the card.
    expect(stub.commentCalls.map(call => call.text)).toEqual(['cc', 'aa', 'bb'])
  })

  it('a budget of 1 serializes the rule lane again (the number IS the throttle)', async () => {
    const { controller, stub } = ruleHarness(['s-a', 's-b'], {})
    controller.setCruiseLimit(1)
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'dd', cron: '', trigger: 'on-complete', send: 'queue' })!
    controller.createSessionRule(task.id, { sessionId: 's-b', instruction: 'ee', cron: '', trigger: 'on-complete', send: 'queue' })!
    await controller.runTask(task.id)
    const run = stub.runCalls[0]
    run.fire({ kind: 'settled', taskId: task.id, executionId: run.executionId, outcome: 'succeeded' })
    await flush()
    // Both rules are due; one slot → one round in flight, the next follows
    // when it settles (never a burst, exactly as the limit promises).
    const fired = () => stub.commentCalls.filter(call => call.text === 'dd' || call.text === 'ee')
    expect(fired().map(call => call.text)).toEqual(['dd'])
    fired()[0].fire({ kind: 'settled', taskId: task.id, executionId: fired()[0].executionId, outcome: 'cancelled' })
    await flush()
    // Cancelled does not re-fire its own loop rule; the other rule still gets
    // its turn once the slot frees.
    expect(fired().map(call => call.text)).toEqual(['dd', 'ee'])
  })

  it('a finished steer never pulls the card out of 进行中 while another lane is still working', async () => {
    // The steer round is settled at birth and lives anywhere in the history,
    // so once lanes can interleave rows a stale steer must not decide the
    // column: the column is the aggregate of the card's sessions.
    const { controller, sessions, stub } = ruleHarness(['s-a', 's-b'], {
      sessionMessage: async () => ({ ok: true as const }),
    })
    controller.setCruiseEnabled(true)
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    // Cruise on a todo card = the board also starts a plain run for it; bind
    // and finish that lane so this test sees only the two conversations it is
    // about (an unbound round legitimately freezes admission for the card, see
    // the test above about it).
    for (const call of [...stub.runCalls]) {
      call.fire({ kind: 'started', taskId: task.id, executionId: call.executionId, sessionId: 's-run' })
      call.fire({ kind: 'settled', taskId: task.id, executionId: call.executionId, outcome: 'succeeded' })
    }
    await controller.steerComment(task.id, 's-a', '插话一条')
    await flush()
    sessions.setRunning('s-a', true)
    await flush()
    expect(controller.getSnapshot().tasks[0].status).toBe('running')
    // A second conversation of the same card starts working (its round opens).
    controller.submitSessionComment(task.id, 's-b', '另一条会话在跑')
    expect(stub.commentCalls).toHaveLength(1)
    // The steered session finishes FIRST: the card stays 进行中 (row badge and
    // column agree — the iron law), because a lane is still in flight.
    sessions.setRunning('s-a', false)
    await flush()
    await flush()
    const mid = controller.getSnapshot().tasks[0]
    expect(mid.status).toBe('running')
    // Only when the last lane settles does the card land in 待审核.
    const call = stub.commentCalls[0]
    call.fire({ kind: 'settled', taskId: task.id, executionId: call.executionId, outcome: 'succeeded' })
    expect(controller.getSnapshot().tasks[0].status).toBe('review')
  })

  it('a queued cron rule instruction is not stacked while its lane is busy (one due instant, one round)', async () => {
    const { controller } = ruleHarness(['s-a'], {})
    controller.setCruiseEnabled(true)
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    // Occupy the rule's session with a comment round that is still running.
    controller.submitSessionComment(task.id, 's-a', '占住这条会话')
    expect(controller.getSnapshot().tasks[0].executions.filter(round => round.comment !== undefined)).toHaveLength(1)
    controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'nightly', cron: '* * * * *', send: 'queue' })!
    await controller.tickSessionRules(NOW + 120_000)
    const afterFirst = controller.getSnapshot().tasks[0]
    const ruleRounds = (row: typeof afterFirst) => row.executions.filter(round => round.ruleId !== undefined).length
    expect(ruleRounds(afterFirst)).toBe(1)
    expect(afterFirst.rules?.[0].lastAt).toBe(NOW + 120_000)
    // The next due instant arrives while that instruction is still waiting for
    // its lane: the slot rolls forward, no second copy piles up behind it.
    const rolled = afterFirst.rules![0].nextAt!
    await controller.tickSessionRules(rolled)
    const afterSecond = controller.getSnapshot().tasks[0]
    expect(ruleRounds(afterSecond)).toBe(1)
    expect(afterSecond.rules![0].nextAt).toBeGreaterThan(rolled)
  })

  it('a noise external round that is NOT the last record is cancelled on the short grace', async () => {
    // The 90s noise cancel used to look only at the last row; with lanes, a
    // later saved/comment row hides the noisy external round and the card
    // stayed 进行中 until the 3-minute delivery watchdog.
    const stub = new StubExec()
    stub.reconcileResult = undefined // no turn evidence
    const store = new InMemoryTaskStore()
    const seeded = createTask({ title: 'x', description: '', prompt: 'run' }, NOW, 'task-a')
    store.save([{
      ...seeded,
      status: 'running',
      executions: [
        { id: 'x1', sessionId: 's-1', startedAt: NOW - 100_000, endedAt: undefined, result: undefined, error: undefined, external: true, comment: '占位' },
        { id: 'c2', sessionId: 's-2', startedAt: NOW, endedAt: NOW + 1, result: 'succeeded' as const, error: undefined, comment: '后来的行' },
      ],
    }])
    const sessions = new FakeSessions()
    sessions.setRunning('s-1', false)
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService, sessions,
      now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    await flush()
    const row = controller.getSnapshot().tasks[0]
    expect(row.executions.find(round => round.id === 'x1')?.endedAt).toBeDefined()
    expect(row.status).not.toBe('running')
  })

  it('a direct steer sends with the OFFICIAL steer mode and drives the card running → review (插话状态根治)', async () => {
    let receivedMode: string | undefined
    const { controller, sessions } = ruleHarness(['s-a'], {
      sessionMessage: async (_sessionId, _text, _images, mode) => { receivedMode = mode; return { ok: true as const } },
    })
    const task = controller.createTask({ title: 't', description: '', prompt: 'run' })!
    await controller.steerComment(task.id, 's-a', '现在立刻做')
    await flush()
    // 插话 = 真插话：the wire got the OFFICIAL steer disposition.
    expect(receivedMode).toBe('steer')
    const row0 = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row0.executions.some(round => round.direct === true && round.comment === '现在立刻做')).toBe(true)
    // Not running yet: the session hasn't started on the host.
    expect(row0.status).not.toBe('running')
    // The native session starts working → the card joins 进行中 (one live
    // derivation — never a dead card again).
    sessions.setRunning('s-a', true)
    await flush()
    const row1 = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.liveStateOf(task.id)).toBe('running')
    expect(row1.status).toBe('running')
    // The session finishes → the steer's completion is a completion: 待审核
    // (and any on-complete rule would fire through the shared appointment).
    sessions.setRunning('s-a', false)
    await flush()
    const row2 = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(controller.liveStateOf(task.id)).toBe('idle')
    expect(row2.status).toBe('review')
  })

  it('a USER comment round settle fires the rule too (评论驱动的完成也是完成)', async () => {
    const { controller, stub } = ruleHarness(['s-a'], {})
    // A settled-column task: comments still inject there (the drive mode), and
    // the cruise ON cannot hijack it with a fresh pickup.
    const task = controller.createTask({ title: 't', description: '', prompt: 'run', status: 'review' })!
    controller.createSessionRule(task.id, { sessionId: 's-a', instruction: 'hi', cron: '', trigger: 'on-complete', send: 'queue' })!
    controller.setCruiseEnabled(true)
    // The user drives the session from the review-page composer: the comment
    // round injects (cruise on) — "在评论区留言过" 之后任务落 「待审核」。
    controller.submitSessionComment(task.id, 's-a', '用户的话')
    expect(stub.commentCalls.map(call => call.text)).toEqual(['用户的话'])
    // That turn settles: it IS a completion — the on-complete rule fires.
    stub.commentCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: stub.commentCalls[0].executionId, outcome: 'succeeded' })
    await flush()
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    const fired = row.executions.find(candidate => candidate.ruleId !== undefined)
    expect(fired?.comment).toBe('hi')
    expect(stub.commentCalls.map(call => call.text)).toEqual(['用户的话', 'hi'])
    // The rule's OWN round settle continues the loop — never a double fire.
    const loop = stub.commentCalls.find(call => call.text === 'hi')!
    loop.fire({ kind: 'settled', taskId: task.id, executionId: loop.executionId, outcome: 'succeeded' })
    await flush()
    expect(controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!.executions.filter(candidate => candidate.ruleId !== undefined)).toHaveLength(2)
  })

  it('a usePrompt CRON rule sends the TASK execution prompt on schedule', async () => {
    const sent: Array<[string, string]> = []
    const { controller } = ruleHarness(['s-a'], { sessionMessage: async (sessionId, text) => { sent.push([sessionId, text]); return { ok: true as const } } })
    const task = controller.createTask({ title: 't', description: '', prompt: '画一只猫' })!
    controller.createSessionRule(task.id, { sessionId: 's-a', instruction: '', cron: '* * * * *', usePrompt: true, send: 'steer' })!
    await controller.tickSessionRules(NOW + 120_000)
    expect(sent).toEqual([['s-a', '画一只猫']])
    // An edit to the prompt applies at the NEXT fire (non-snapshot content).
    controller.updateTask(task.id, { prompt: '画一只狗' })
    await controller.tickSessionRules(NOW + 240_000)
    expect(sent).toEqual([['s-a', '画一只猫'], ['s-a', '画一只狗']])
  })

  it('a CUSTOM rule on an EMPTY-prompt task still fires on schedule (its content is its own)', async () => {
    const sent: Array<[string, string]> = []
    const { controller } = ruleHarness(['s-a'], { sessionMessage: async (sessionId, text) => { sent.push([sessionId, text]); return { ok: true as const } } })
    const task = controller.createTask({ title: 't', description: '', prompt: '' })!
    controller.createSessionRule(task.id, { sessionId: 's-a', instruction: '哈哈', cron: '* * * * *', send: 'queue' })!
    await controller.tickSessionRules(NOW + 120_000)
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    const queued = row.executions.find(round => round.comment === '哈哈')
    expect(queued?.comment).toBe('哈哈') // queued: the empty task prompt never mis-blocks it
    expect(queued?.direct).toBeUndefined()
  })

  it('the FIRST real run auto-supplements title/description; repeats never touch them', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: '', description: '', prompt: '画一只猫\n并解释配色' })!
    await controller.runTask(task.id)
    let row = store.load()[0]
    expect(row.title).toBe('画一只猫') // (a) title = first line
    expect(row.description).toBe('画一只猫\n并解释配色') // (a) description = the prompt
    // The first run settles; its prompt is edited (repeat run with a DIFFERENT
    // prompt): the supplement must NOT touch the fields again.
    const e1 = exec.runCalls[0].executionId
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: e1, outcome: 'succeeded' })
    controller.updateTask(task.id, { prompt: '画一只狗' })
    await controller.rerunTask(task.id)
    row = store.load()[0]
    expect(row.title).toBe('画一只猫')
    expect(row.description).toBe('画一只猫\n并解释配色')
  })

  it('createTask supplements empty title/description from a present prompt AT ONCE (缺则补)', () => {
    const { controller } = makeController()
    const task = controller.createTask({ title: '  ', description: '', prompt: '画一只猫\n并解释配色' })!
    expect(task.title).toBe('画一只猫')
    expect(task.description).toBe('画一只猫\n并解释配色')
    // No prompt — nothing to derive: the head stays blank (未命名 placeholder).
    const bare = controller.createTask({ title: '', description: '', prompt: '' })!
    expect(bare.title).toBe('')
    expect(bare.description).toBe('')
  })

  it('updateTask supplements a blank head once a prompt arrives (编辑时缺则补)', () => {
    const { controller } = makeController()
    const task = controller.createTask({ title: '', description: '', prompt: '' })!
    expect(task.title).toBe('') // before the prompt there is nothing to derive
    controller.updateTask(task.id, { prompt: '画一只猫\n并解释配色' })
    const row = controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!
    expect(row.title).toBe('画一只猫')
    expect(row.description).toBe('画一只猫\n并解释配色')
    // 填则守: an edit that keeps the (filled) fields never touches them.
    controller.updateTask(task.id, { prompt: '画一只狗' })
    expect(controller.getSnapshot().tasks.find(candidate => candidate.id === task.id)!.title).toBe('画一只猫')
  })

  it('every real launch supplements: a seeded blank-head task picked up by the CRUISE runs with its head', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    const task = seedTask(store, { id: 'task-a' })
    store.save([{ ...task, title: '', description: '', prompt: '干活\n第二行', status: 'todo' }])
    const sessions = new FakeSessions()
    const reloaded = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    reloaded.start()
    // The cruise pickup launches through the ONE launch door — the supplement
    // applies there, never bypassed by automation (launchTask, not runTask).
    reloaded.setCruiseEnabled(true)
    expect(reloaded.getSnapshot().tasks[0].title).toBe('干活')
    expect(reloaded.getSnapshot().tasks[0].description).toBe('干活\n第二行')
    expect(stub.runCalls).toHaveLength(1)
    expect(stub.runCalls[0].task.title).toBe('干活')
  })
})

describe('BoardController engine seat + remote apply', () => {
  /** A store wrapper that counts save calls (to prove applyRemote never echoes). */
  function countingStore(): { store: InMemoryTaskStore; saves: () => number } {
    const inner = new InMemoryTaskStore()
    let saves = 0
    const store = new Proxy(inner, {
      get(target, prop) {
        if (prop === 'save') return (tasks: readonly TaskRecord[]): void => { saves += 1; target.save(tasks) }
        const value = Reflect.get(target, prop, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as InMemoryTaskStore
    return { store, saves: () => saves }
  }

  it('a non-engine replica relays runTask to the engine instead of launching', async () => {
    const stub = new StubExec()
    const relays: Array<{ id: string; trigger: string }> = []
    const store = new InMemoryTaskStore()
    store.save([createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'task-a')])
    const sessions = new FakeSessions()
    const controller = new BoardController({ store, exec: stub as unknown as ExecutionService, sessions, now: () => NOW, uuid, requestLaunch: (id, trigger) => relays.push({ id, trigger }) })
    controller.start()
    controller.setEngine(false)
    const accepted = await controller.runTask('task-a', 'manual')
    expect(accepted).toBe(true)
    expect(relays).toEqual([{ id: 'task-a', trigger: 'manual' }])
    expect(stub.runCalls).toHaveLength(0)
  })

  it('a non-engine replica with no relay rejects the run', async () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    store.save([createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'task-a')])
    const controller = new BoardController({ store, exec: stub as unknown as ExecutionService, sessions: new FakeSessions(), now: () => NOW, uuid })
    controller.start()
    controller.setEngine(false)
    expect(await controller.runTask('task-a', 'manual')).toBe(false)
    expect(stub.runCalls).toHaveLength(0)
  })

  it('the dispatch pump is a no-op off the engine and re-pumps on takeover', () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    store.save([createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'task-a')])
    const controller = new BoardController({ store, exec: stub as unknown as ExecutionService, sessions: new FakeSessions(), now: () => NOW, uuid })
    controller.start()
    // A todo task with a prompt: cruise would pick it up when the engine pumps.
    controller.setEngine(false)
    controller.setCruiseEnabled(true)
    expect(stub.runCalls).toHaveLength(0)
    // Taking the seat re-pumps: the pending cruise pickup launches now.
    controller.setEngine(true)
    expect(controller.isEngine()).toBe(true)
    expect(stub.runCalls).toHaveLength(1)
  })

  it('applyRemote replaces the ledger + cruise and notifies, without echoing a save', () => {
    const { store, saves } = countingStore()
    const controller = new BoardController({
      store, exec: new StubExec() as unknown as ExecutionService,
      sessions: new FakeSessions(), now: () => NOW, uuid,
    })
    controller.start()
    // A review-column task: the engine pump never picks it up (cruise takes
    // todo only), so a launch cannot mask the "applyRemote does not save" check.
    const remote = withStatus(createTask({ title: '远端', description: '', prompt: 'p' }, NOW, 'task-remote'), 'review', NOW)
    let notified = 0
    controller.subscribe(() => { notified += 1 })
    const savesBefore = saves()
    controller.applyRemote({
      tasks: [remote],
      cruise: { enabled: true, limit: 4, schedule: [] },
      schedulePresets: [],
      runPresets: { presets: [] },
    })
    expect(controller.getSnapshot().tasks.map(t => t.id)).toEqual(['task-remote'])
    expect(controller.getSnapshot().cruise.enabled).toBe(true)
    expect(controller.getSnapshot().cruise.limit).toBe(4)
    expect(notified).toBeGreaterThan(0)
    // The remote state came from the host: applying it must not write back.
    expect(saves()).toBe(savesBefore)
  })

  it('a non-engine replica still accepts user writes and mirrors remote state', () => {
    const stub = new StubExec()
    const store = new InMemoryTaskStore()
    store.save([createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'task-a')])
    const controller = new BoardController({ store, exec: stub as unknown as ExecutionService, sessions: new FakeSessions(), now: () => NOW, uuid })
    controller.start()
    controller.setEngine(false)
    // A local edit is accepted (it will sync); no launch happens here.
    controller.setTaskColor('task-a', '#ff0000')
    expect(controller.getSnapshot().tasks[0].color).toBe('#ff0000')
    expect(stub.runCalls).toHaveLength(0)
  })

  it('setHostProto mirrors the seat announcement into the snapshot (change → notify)', () => {
    // The stale-host banner reads snapshot.engine.hostProto. A host restart
    // changes the protocol WITHOUT changing the seat — the wiring's seat
    // listener calls this, so the banner clears live on every device.
    const store = new InMemoryTaskStore()
    const controller = new BoardController({ store, exec: new StubExec() as unknown as ExecutionService, sessions: new FakeSessions(), now: () => NOW, uuid })
    controller.start()
    // The default is CURRENT: no lease read = no claim, never a false alarm.
    expect(controller.getSnapshot().engine.hostProto).toBe(2)
    let notified = 0
    controller.subscribe(() => { notified += 1 })
    controller.setHostProto(1) // an old host answers the first lease
    expect(controller.getSnapshot().engine.hostProto).toBe(1)
    expect(notified).toBe(1)
    controller.setHostProto(1) // a heartbeat changes nothing → no notify
    expect(notified).toBe(1)
    controller.setHostProto(2) // the host restarts while the seat stays put
    expect(controller.getSnapshot().engine.hostProto).toBe(2)
    expect(notified).toBe(2)
  })
})

/** Build a task with a bind (test helper). */
function taskWithBind(bind: NonNullable<TaskRecord['bind']>): TaskRecord {
  return { id: 'task-b', title: 'T', description: '', prompt: 'run', status: 'todo', order: 0, createdAt: 0, updatedAt: 0, executions: [], bind }
}
