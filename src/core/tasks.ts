/**
 * Task board domain model: task lifecycle statuses, the task record shape,
 * and the pure transition functions the controller and tests share.
 * Framework-free (no cordis, no runtime imports) so the state machine is
 * unit-testable in isolation.
 */

/** Task lifecycle status, one per kanban column. */
export type TaskStatus = 'backlog' | 'todo' | 'running' | 'review' | 'done'

/**
 * One execution round: a full run attempt (or a comment continuation that
 * kept an existing session going). The run's own id, the dsh session that
 * carried it (filled once known), and the settled outcome once the session's
 * turn ended. A round with `comment` set is a comment continuation: it never
 * appears in the execution-history list (comments live in the review page's
 * comment thread), but it is a first-class round for settlement, persistence
 * and the running-state machine.
 */
export interface ExecutionRecord {
  /** Execution attempt id (uuid). */
  id: string
  /** The dsh session that ran this attempt; absent until creation resolves. */
  sessionId: string | undefined
  /** When the run started (ms epoch). */
  startedAt: number
  /** When the run settled; absent while still running. */
  endedAt: number | undefined
  /** Outcome once settled. */
  result: 'succeeded' | 'failed' | 'cancelled' | undefined
  /** Human failure text when the run failed (prompt rejection or agent error). */
  error: string | undefined
  /** The comment text when this round is a comment continuation (absent = a plain run). */
  comment?: string
  /**
   * Images attached to a comment round (the same base64 wire shape as a task
   * prompt image). A QUEUED comment carries its pictures on the round so the
   * dispatcher sends text + images together when the lane frees — the send
   * mode (排队 vs 插话) is the user's choice and is NEVER overridden by the
   * mere presence of images.
   */
  promptImages?: TaskImage[]
  /**
   * File refs attached to a comment round (the OFFICIAL `{type:'file',
   * receiptId}` shape). Same queueing as images: a QUEUED comment carries
   * its files on the round so the dispatcher sends text + files together
   * when the lane frees.
   */
  promptFiles?: TaskFile[]
  /**
   * When the user last opened this execution's review page (ms epoch),
   * clearing its unread reminder. Absent on legacy rows — the display layer
   * falls back to the run's own latest activity, so old content never lights
   * up as unread after an upgrade.
   */
  viewedAt?: number
  /**
   * Whether this comment round is a slash command rather than a turn: the
   * line is executed through the native command registry (never delivered
   * to the model as text). Unknown commands fall back to plain text.
   */
  command?: boolean
  /**
   * When a comment continuation was actually injected into its session (ms
   * epoch). Absent = the comment is still saved/queued and can be cancelled;
   * present = the session is (or was) running it and the round can only be
   * observed.
   */
  injectedAt?: number
  /**
   * The plain execution this comment round continues (the record whose
   * review page the comment was submitted from; its session is reused).
   * Present on rounds created after this field existed; older persisted
   * rounds omit it and are attributed by session instead. Comment rounds
   * only ever carry it — plain runs never do.
   */
  parentExecutionId?: string
  /**
   * The linked session this comment round continues (submitted from a
   * linked-session panel's drive-mode composer; `sessionId` points at the
   * same session). The session-anchored counterpart of
   * `parentExecutionId`: a round anchored this way has no parent execution
   * — it keeps the linked session's conversation alive and drives the task
   * exactly like any other comment round (same per-task FIFO queue, same
   * dispatcher injection). Only comment rounds carry it, and a round never
   * carries both anchors.
   */
  sessionAnchor?: string
  /**
   * The session automation rule this comment round was created by (preset
   * instruction / 完成后续跑 loop). A settled rule round with a SUCCEEDED
   * outcome re-fires its owning on-complete rule — the 完成后续跑 loop — so
   * the rule keeps repeating after each turn it triggered; rounds without a
   * ruleId (or with a failed outcome) never re-fire anything, so no storm.
   */
  ruleId?: string
  /**
   * A direct-send round: a message the user sent straight to the native
   * session (直发模式) — recorded so it appears in the session's comment
   * thread next to drive comments and execution comments, but never queued,
   * injected or driven (it is already delivered: `endedAt` and `result` are
   * set at creation, there is no `injectedAt`). Purely a thread record —
   * task state, dispatcher and queues ignore it.
   */
  direct?: boolean
  /**
   * An externally-observed round: the task's related session had real
   * activity OUTSIDE the board (a user chatted directly in the native UI,
   * or the agent did something the board did not record) — detected from the
   * session list's running flip. Unlike comment/direct rounds it is
   * populated by observation, not submission: it drives the card into 「进行中」
   * and settles to 「待审核」 like a real round, appears in the session's
   * comment thread (its text is filled at settle when history yields it),
   * but is NEVER queued or injected (it is already running out-of-band).
   */
  external?: boolean
  /**
   * An externally-observed round whose latest native user message carried NO
   * text (a picture-only message): the thread shows the 图片消息 placeholder
   * instead of a state word dressed up as content — never stale text from an
   * older message.
   */
  imageOnly?: boolean
  /**
   * The native log seq of the user message that started an externally-observed
   * turn — THE turn anchor. Both detection channels (the live frame and
   * the reconcile state backstop) dedup on it, across passes, devices and
   * engine handovers: the same native turn is never recorded twice, and a
   * reload cannot lose the "already recorded this turn" fact.
   */
  anchor?: number
}

/** How a scheduled task is driven: cron = fire at fixed times; chain = rerun right after each run settles. */
export type ScheduleMode = 'cron' | 'chain'

/** A live binding to ONE native source — a session or a whole workspace
 *  folder. A task may hold several (each drag-in ADDS one, never replaces). */
export type TaskBind =
  | { kind: 'session'; sessionId: string }
  | { kind: 'workspace'; workspaceId: string }

/** The task's live bindings: the multi-source list, with the legacy single
 *  `bind` field projected as a one-element list (old data parses untouched).
 *  EVERY reader goes through here — never the raw field. */
export function taskBindsOf(task: TaskRecord): TaskBind[] {
  const binds = task.binds
  if (binds !== undefined && binds.length > 0) return binds
  return task.bind !== undefined ? [task.bind] : []
}

/** Whether two bindings name the SAME source (same kind, same id). */
export function sameBind(a: TaskBind, b: TaskBind): boolean {
  if (a.kind === 'session' && b.kind === 'session') return a.sessionId === b.sessionId
  if (a.kind === 'workspace' && b.kind === 'workspace') return a.workspaceId === b.workspaceId
  return false
}

/** The card's source-line label — ONE derivation for every card: the bound
 *  session's title when the task has a session source and that title differs
 *  from the task's own title (a source named exactly like the task is the
 *  task itself — never a repeated line), else the workspace label, skipped
 *  the same way. Empty = no source line (the card shows no source, never a
 *  guessed default). Callers pass the RESOLVED titles (live titles, raw ids
 *  as fallback); this is pure display policy. */
export function cardSourceLabel(task: TaskRecord, boundTitle: string, workspaceTitle: string): string {
  if (boundTitle !== '' && boundTitle !== task.title) return boundTitle
  if (workspaceTitle !== '' && workspaceTitle !== task.title) return workspaceTitle
  return ''
}

/** Brand an unknown string as a schedule mode. */
export function isScheduleMode(value: unknown): value is ScheduleMode {
  return value === 'cron' || value === 'chain'
}

/**
 * A scheduled-run rule attached to a task. Two modes share one rule:
 * - `cron`: the browser-side scheduler ticks every minute and triggers the
 *   task when `nextRunAt` is due (a 5-field cron expression).
 * - `chain`: the task reruns as soon as its previous run settles — "run
 *   after completion". `cron`/`nextRunAt` are unused; the rule fires the
 *   first run on enable and every settled run starts the next, until
 *   `maxRuns` is reached (undefined = unlimited, i.e. continuously running)
 *   or a run fails.
 * The rule is persisted with the task (localStorage), so scheduling
 * survives refreshes.
 */
export interface ScheduleRule {
  /** Whether the schedule is armed. */
  enabled: boolean
  /** Driving mode; defaults to 'cron' (legacy rules normalize to it). */
  mode: ScheduleMode
  /** 5-field cron expression: `分 时 日 月 周` (cron mode). */
  cron: string
  /** Next due instant (ms epoch); maintained by the scheduler/controller (cron mode). */
  nextRunAt: number | undefined
  /** Instant of the latest scheduled trigger (ms epoch). */
  lastTriggeredAt: number | undefined
  /** How many scheduled runs may fire in total; undefined = unlimited. */
  maxRuns: number | undefined
  /** How many scheduled runs have fired so far (monotone; automatic triggers only). */
  runCount: number
  /**
   * Missed-slot tolerance (ms) for superseded due instants: when a newer cron
   * grid point already passed AND the due instant is older than this, the slot
   * is skipped without catch-up (a slept tab never avalanches). A merely-late
   * tick still fires. Undefined = one scheduler tick. Old rules read it as
   * undefined (same default), so no migration is needed.
   */
  missedToleranceMs?: number
  /**
   * Legacy activation gate: automation now fires as soon as it is armed —
   * there is no "manual run first" step (see {@link ruleReadiness}). Kept on
   * the persisted shape so old data parses; every load/merge normalizes it
   * to true, so no live code ever sees it as false.
   */
  primed: boolean
}

/** One task on the board. */
/** One image attached to a task's execution prompt — the same base64 shape
 *  the native `PromptContentPart` image variant carries (the host admits the
 *  bytes durably when it takes the prompt). */
export interface TaskImage {
  mediaType: string
  /** Canonical base64 (no data-URL prefix). */
  data: string
  name?: string
}

/** One file ref attached to a task's execution prompt — the OFFICIAL
 *  `{type:'file', receiptId}` shape (files carry no admission limits; the
 *  stored object is the exact submitted bytes). Queued like images: a file
 *  staged for a session rides the round until the lane frees. */
export interface TaskFile {
  receiptId: string
  name: string
  bytes: number
}

export interface TaskRecord {
  /** Stable task id (uuid). */
  id: string
  /** Short display title. */
  title: string
  /** Longer human description shown in the detail view. */
  description: string
  /** The prompt sent to dsh when this task is executed. */
  prompt: string
  /**
   * Images attached to the execution prompt — the OFFICIAL temporary-bytes
   * image shape (base64 + media type), PERSISTED with the task so EVERY run
   * path (manual / scheduled / cruise / chain / rerun) sends the same
   * picture-text prompt. Deliberately tiny by contract: the browser
   * compresses each image hard before it lands here and the form caps the
   * count (this rides the shared board document to every device). Absent =
   * a text-only prompt (the overwhelming majority of tasks).
   */
  promptImages?: TaskImage[]
  /**
   * File refs attached to the execution prompt — the OFFICIAL
   * `{type:'file', receiptId}` shape, PERSISTED with the task like images.
   * Receipts are staged per-Agent: a receipt minted for one session MUST be
   * re-staged before a run on another session (the send layer re-uploads by
   * name when the stored receipt is rejected — files are re-readable from
   * the composer's staged bytes, never re-asked from the user).
   */
  promptFiles?: TaskFile[]
  /** Current column. */
  status: TaskStatus
  /** Column-move history (newest last; the creation column is the first
   *  entry): every real transition appends here through withStatus (the one
   *  funnel — startExecution/settle/applyCardOrder all read it). Absent on
   *  legacy rows (treated as "always this column"). Human-scale: moves are
   *  manual acts, so no cap is needed — the array stays tiny.
   */
  statusHistory?: Array<{ status: TaskStatus; at: number }>
  /** Column sort key (ascending; legacy rows are normalized on load). */
  order: number
  /** Creation instant (ms epoch). */
  createdAt: number
  /** Last mutation instant (ms epoch). */
  updatedAt: number
  /** Every execution attempt, most recent last. */
  executions: ExecutionRecord[]
  /** Optional scheduled-run rule (absent on tasks without a schedule). */
  schedule?: ScheduleRule
  /** Per-task run configuration (absent fields fall back to defaults). */
  workspaceId?: string
  provider?: string
  model?: string
  reasoningEffort?: string
  /** Agent preset to compose the execution session from (absent = deployment default). */
  agentPreset?: string
  /** Permission preset key applied to the execution session before its first prompt (absent = session default). */
  permission?: string
  /**
   * Live bindings to native sources — sessions and/or whole workspace folders
   * (dragged in from the sidebar, one ADD at a time). The set decides the
   * source of the card's "链接会话" (linked sessions) section — a pure,
   * live-synced view of every bound source's sessions (same session yields
   * one row) — and nothing else: the card keeps its own title, description,
   * prompt, run config, scheduling and executions exactly as a
   * plain task. Absent = a plain prompt-driven task (the pre-bind behavior).
   */
  binds?: TaskBind[]
  /** Legacy single-source binding (pre multi-bind). Kept so old data parses;
   *  every reader goes through {@link taskBindsOf} — never read directly. */
  bind?: TaskBind
  /**
   * Display-only row hiding sets — rows the user chose not to see, neither
   * deleted nor archived (hiding keeps task numbering stable). `executions`
   * holds execution-record ids, `sessions` holds linked-session ids. The
   * "同步 / 恢复全部已隐藏" actions clear the relevant set.
   */
  hidden?: { executions?: string[]; sessions?: string[] }
  /**
   * Sessions PERMANENTLY removed from this task (the hidden tray's irreversible
   * 删除). Unlike {@link hidden}, a removed session can never re-derive from a
   * bound workspace — deleting a workspace member must not resurrect it. The
   * execution rounds of a removed session are also gone; the task itself and
   * every other session stay. Absent = nothing removed.
   */
  removedSessions?: string[]
  /**
   * The user's manual order of the 会话 list (sessionIds, top first). Written
   * only after the user re-orders rows by drag; rows outside the array (new
   * sessions from a bind, a fresh run or a rerun) keep landing at the TOP
   * (newest-activity-first), so "拖进来的/重跑的都排最上面" stays true unless
   * the user drags them. Absent = the default newest-activity order.
   */
  sessionsOrder?: string[]
  /**
   * When the user last opened this task's detail (ms epoch), clearing the
   * card's unread reminder. Absent on legacy rows — the display layer falls
   * back to the task's newest round activity, so already-seen content stays
   * quiet after an upgrade. New tasks start viewed at their creation.
   */
  viewedAt?: number
  /**
   * A per-card accent color (hex string, applied as an inline tint — data,
   * never a CSS literal). Absent = no accent.
   */
  color?: string
  /**
   * Session automation rules — scheduled "send a preset instruction to one
   * of this task's sessions" rules (see automation.ts). Absent = none.
   */
  rules?: import('./automation.ts').SessionRule[]
}

/** Input for creating a task. */
export interface NewTaskInput {
  title: string
  description: string
  prompt: string
  /** Images attached to the execution prompt (already compressed by the
   *  browser intake; capped in count by the form). */
  promptImages?: TaskImage[]
  /** File refs attached to the execution prompt (receipt shape — the twin
   *  lane of images: every birth/copy/template/draft path carries both or
   *  documents why not, never one silently). */
  promptFiles?: TaskFile[]
  /** Landing column; defaults to 'todo'. Any column is legal — an external
   *  sidebar drop lands in exactly the column it was dropped into. */
  status?: TaskStatus
  workspaceId?: string
  provider?: string
  model?: string
  reasoningEffort?: string
  agentPreset?: string
  permission?: string
  /** Accent color (hex string data, never CSS); absent = no accent. */
  color?: string
}

/** The five kanban columns, in display order. */
export const COLUMNS: readonly { status: TaskStatus; label: string }[] = [
  { status: 'backlog', label: '待规划' },
  { status: 'todo', label: '待办' },
  { status: 'running', label: '进行中' },
  { status: 'review', label: '待审核' },
  { status: 'done', label: '已完成' },
]

/** Statuses a user may move a card to manually (execution states are owned by the runner). */
export const MANUAL_STATUSES: readonly TaskStatus[] = ['backlog', 'todo', 'done']

/**
 * The status one column over, along the board's own COLUMNS order — the keyboard
 * equivalent of dragging a card one column. Pure, and deliberately derived from
 * COLUMNS rather than from a second hand-written list: a column added or
 * reordered in the board is reachable by `[` / `]` the same day.
 *
 * Returns undefined at either end and for a status the board does not show, so
 * the caller can stay silent instead of inventing a move. Whether the step is
 * actually ALLOWED is `resolveCardDrop`'s judgment, not this function's: this
 * answers "which column is next", never "may I".
 */
export function adjacentStatus(status: TaskStatus, direction: -1 | 1): TaskStatus | undefined {
  const at = COLUMNS.findIndex(column => column.status === status)
  if (at < 0) return undefined
  return COLUMNS[at + direction]?.status
}

/** All valid statuses (closed union guard). */
export const ALL_STATUSES: readonly TaskStatus[] = [
  'backlog', 'todo', 'running', 'review', 'done',
]

/** Brand an unknown string as a status; undefined when it is not one. */
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (ALL_STATUSES as readonly string[]).includes(value)
}

/**
 * The landing column of a task created by an external sidebar drop: the
 * column the item was dropped into — all five columns are respected, so a
 * drop on 进行中 / 待审核 / 已完成 stays exactly where it landed.
 */
export function landingStatusOf(dropStatus: TaskStatus): TaskStatus {
  return dropStatus
}

/**
 * How an armed schedule rule behaves for a task right now. One shared
 * judgment used by the scheduler (what may trigger), the controller (what
 * a chain may own) and the detail panel (what to display):
 * - `disabled`: the rule is not armed — nothing to consider.
 * - `paused`: armed, but the task sits in a state the rule must not drive
 *   (backlog = shelved, review = a human decision is pending, done =
 *   completed). Any manual action that leaves these states (run, or move to
 *   todo/done) resumes the rule; missed due instants are skipped, never
 *   caught up. Completion additionally disarms the rule outright (see
 *   {@link disarmSchedule}) — `paused` here is the safety net for legacy/
 *   repaired rows that would otherwise hold a stale enabled flag.
 * - `active`: armed and the task is in a drivable state (todo/running) —
 *   cron due instants and chain hand-offs fire. Arming alone is enough:
 *   automation is active as soon as it is enabled (no manual-first-run
 *   gate).
 */
export type RuleReadiness =
  | { kind: 'disabled' }
  | { kind: 'blocked' }
  | { kind: 'paused'; status: 'backlog' | 'review' | 'done' }
  | { kind: 'active' }

/**
 * Whether the task has anything EXECUTABLE to drive: its execution prompt is
 * non-empty (trimmed). THE one judgment every drive path reads — a task with
 * no prompt can never be run, automated, cruised or comment-driven.
 * Empty means strictly blank; placeholder text is not empty.
 */
export function taskExecutable(task: TaskRecord): boolean {
  return task.prompt.trim() !== ''
}

/**
 * 真执行自动补全（缺则补、填则守、任何执行时刻）：新建任务允许
 * 标题/描述全空——**任何一次**真正执行（手动/重复/接续链/定时/巡航/自动化）
 * 时，缺什么补什么；已存在的字段永不覆盖（用户内容保真——「不会再动」=
 * 已填的不动，缺的补齐）。评论轮/外源轮不是任务执行，不触发。
 * 标题缺 → 执行 Prompt 的第一个非空行（trim + 40 字符上限）；
 * 描述缺 → 整个执行 Prompt（trim）。
 * 返回需要补的字段（无则 undefined）。
 */
export function supplementLaunchFields(task: TaskRecord): { title?: string; description?: string } | undefined {
  if (!taskExecutable(task)) return undefined
  const prompt = task.prompt.trim()
  if (prompt === '') return undefined
  const supplements: { title?: string; description?: string } = {}
  if (task.title.trim() === '') {
    const firstLine = prompt.split(/\r?\n/).map(line => line.trim()).find(line => line !== '') ?? ''
    supplements.title = firstLine.slice(0, 40)
  }
  if (task.description.trim() === '') {
    supplements.description = prompt
  }
  return supplements.title !== undefined || supplements.description !== undefined ? supplements : undefined
}

/**
 * Whether the task's COLUMN currently allows automation to run. One shared
 * judgment for EVERY automation kind — the task-level schedule rule and the
 * session-level rules read the same set: only todo/running are drivable;
 * backlog (shelved), review (a human decision is pending) and done
 * (completed) pause whichever rule armed them.
 */
export function taskColumnAllowsAutomation(task: TaskRecord): boolean {
  return task.status !== 'backlog' && task.status !== 'review' && task.status !== 'done'
}

/** The readiness of a task's schedule rule (see {@link RuleReadiness}). */
export function ruleReadiness(task: TaskRecord): RuleReadiness {
  const schedule = task.schedule
  if (schedule === undefined || !schedule.enabled) return { kind: 'disabled' }
  // Nothing to drive: an armed rule with an empty prompt cannot execute —
  // it reads as blocked (a reason, not a pause), never silently fires.
  if (!taskExecutable(task)) return { kind: 'blocked' }
  // A CHAIN's column never pauses it: the hand-off runs at the settle
  // instant (the task was drivable when the run started; the completion IS
  // the appointment — "完成后接续" keeps going). Only the cron wheel obeys
  // the column pause, because its scheduled instant can land on a shelved
  // card.
  if (schedule.mode === 'chain') return { kind: 'active' }
  // Every status outside the rule's active set (backlog/review/done) is a
  // pause: the rule must never drive a task a human is holding.
  if (!taskColumnAllowsAutomation(task)) {
    return { kind: 'paused', status: task.status as 'backlog' | 'review' | 'done' }
  }
  return { kind: 'active' }
}

/**
 * Whether a NEW arm of the task's schedule rule is refused outright. THE one
 * judgment every arming path reads — the controller's write and the editor's
 * switch both call it, so "the switch says on" and "the rule is armed" can
 * never disagree.
 *
 * A rule drives its task through the task's own execution prompt, so a task
 * with no prompt has nothing to run in EITHER mode: cron would fire into a
 * no-op and chain would never hand off. Arming is therefore refused for both,
 * and the editor renders the switch as unusable with the reason beside it
 * rather than accepting an arm that can never fire.
 *
 * Disarming is always allowed — a rule already armed before the prompt was
 * cleared stays visible and dis-armable, and {@link ruleReadiness} reports it
 * as blocked in the meantime.
 */
export function ruleArmingBlocked(task: TaskRecord): boolean {
  return !taskExecutable(task)
}

/**
 * Disarm a task's schedule rule for good — the completed-task shut-off. The
 * rule's identity (cron expression, mode, budget, prime, counters) is kept
 * so re-arming it later resumes from the same configured behavior; only
 * `enabled` and the pending `nextRunAt` are cleared. A no-op on tasks with
 * no rule or an already-disarmed one.
 */
export function disarmSchedule(task: TaskRecord, now: number): TaskRecord {
  const schedule = task.schedule
  if (schedule === undefined || !schedule.enabled) return task
  return withSchedule(task, { enabled: false, nextRunAt: undefined }, now)
}

/** Whether a manual move target is allowed from the given status. */
export function canMoveManually(_from: TaskStatus, to: TaskStatus): boolean {
  return (MANUAL_STATUSES as readonly TaskStatus[]).includes(to)
}

/**
 * The task's latest execution (rounds are appended chronologically). The ONE
 * "what's the newest round" derivation every surface reads — the card's
 * settled chip, the board's waiting probe, the detail's failure hint.
 */
export function latestExecutionOf(task: TaskRecord): ExecutionRecord | undefined {
  return task.executions[task.executions.length - 1]
}

/**
 * The outcome of the card's OWN most recent plain run — the answer to "how did
 * this task's last execution end?", used by every surface that tints, labels
 * or explains a card's result.
 *
 * It is deliberately NOT `latestExecutionOf(task)?.result`: with per-session
 * lanes the newest record is routinely something else (a comment round, an
 * observed native turn, or a comment still SAVED with no result at all), which
 * made the same card read as failed on one surface and succeeded on another,
 * and once tinted the 「N 次执行」 chip red while every run had succeeded.
 */
export function lastPlainResult(task: TaskRecord): ExecutionRecord['result'] {
  const runs = plainRunsOf(task)
  return runs[runs.length - 1]?.result
}

/**
 * Whether arming a chain rule needs the one-shot "endless loop" confirmation:
 * an unlimited chain (no run budget) keeps firing real agent sessions until a
 * run fails or the user stops it. One guard, shared by every surface that can
 * arm a chain (the detail editor and the overview's enable switch) — a second
 * surface must never re-derive this decision.
 */
export function chainUnlimited(mode: ScheduleMode | undefined, maxRuns: number | undefined): boolean {
  return mode === 'chain' && (maxRuns === undefined || maxRuns < 1)
}

/** Admitted image media types (the INTAKE gate reads this — new uploads
 *  outside it are rejected or transcoded at the door; stored rows are
 *  grandfathered, see below). */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** Whether a raw value is a storable prompt image (non-empty data + a media
 *  type string). Deliberately LENIENT (no whitelist): storage walls must
 *  never retroactively delete what an older version stored — the whitelist
 *  gates new intake and the send layer, never the ledger. Crash-safety (no
 *  undefined derefs downstream) is what storage guarantees. */
export function isWellFormedImage(entry: unknown): entry is TaskImage {
  if (typeof entry !== 'object' || entry === null) return false
  const candidate = entry as Record<string, unknown>
  return typeof candidate.data === 'string' && candidate.data !== ''
    && typeof candidate.mediaType === 'string' && candidate.mediaType !== ''
}

/** Whether a raw value is a storable file ref (non-empty receipt + name;
 *  bytes only needs to be a number for display math — NaN displays ugly but
 *  never crashes and never deletes). Same leniency law as images above. */
export function isWellFormedFile(entry: unknown): entry is TaskFile {
  if (typeof entry !== 'object' || entry === null) return false
  const candidate = entry as Record<string, unknown>
  return typeof candidate.receiptId === 'string' && candidate.receiptId !== ''
    && typeof candidate.name === 'string' && candidate.name !== ''
    && typeof candidate.bytes === 'number'
}

/** Keep well-formed prompt images (a dirty element washes out, never the
 *  row and never a downstream crash). */
export function normalizePromptImages(raw: unknown): TaskImage[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const kept = raw.filter(isWellFormedImage)
  return kept.length > 0 ? kept : undefined
}

/** Keep well-formed file refs (same law as images). */
export function normalizePromptFiles(raw: unknown): TaskFile[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const kept = raw.filter(isWellFormedFile)
  return kept.length > 0 ? kept : undefined
}

/** Create a task from user input. */
export function createTask(input: NewTaskInput, now: number, id: string, order = 0): TaskRecord {
  const status = input.status ?? 'todo'
  return {
    id,
    title: input.title.trim(),
    description: input.description.trim(),
    prompt: input.prompt.trim(),
    status,
    order,
    createdAt: now,
    updatedAt: now,
    viewedAt: now,
    // The birth column opens the history (every duration derives from here).
    statusHistory: [{ status, at: now }],
    executions: [],
    ...input.promptImages !== undefined && input.promptImages.length > 0
      ? { promptImages: input.promptImages.map(image => ({ ...image })) }
      : {},
    ...input.promptFiles !== undefined && input.promptFiles.length > 0
      ? { promptFiles: input.promptFiles.map(file => ({ ...file })) }
      : {},
    ...input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {},
    ...input.provider !== undefined ? { provider: input.provider } : {},
    ...input.model !== undefined ? { model: input.model } : {},
    ...input.reasoningEffort !== undefined ? { reasoningEffort: input.reasoningEffort } : {},
    ...input.agentPreset !== undefined ? { agentPreset: input.agentPreset } : {},
    ...input.permission !== undefined ? { permission: input.permission } : {},
    ...input.color !== undefined && input.color !== '' ? { color: input.color } : {},
  }
}

/** Clone a task with an updated status and a fresh updatedAt. A real column
 *  move appends to the status history (cycle/streak/throughput derivations
 *  read it — without it every duration is a guess); a same-status touch only
 *  refreshes updatedAt. A legacy row moving for the first time backfills its
 *  birth column from createdAt (the honest birth instant, same as the read
 *  path — one birth rule, never two). */
export function withStatus(task: TaskRecord, status: TaskStatus, now: number): TaskRecord {
  if (task.status === status) return { ...task, updatedAt: now }
  const birthAt = Number.isFinite(task.createdAt) && task.createdAt > 0 ? task.createdAt : task.updatedAt
  const birth = task.statusHistory === undefined ? [{ status: task.status, at: birthAt }] : []
  return {
    ...task,
    status,
    updatedAt: now,
    statusHistory: [...birth, ...(task.statusHistory ?? []), { status, at: now }],
  }
}

/**
 * Merge a schedule patch into a task's schedule rule (creating it when
 * absent), with a fresh updatedAt. Keys present in the patch overwrite the
 * current value — including explicit `undefined`, which clears a field (used
 * to disarm `nextRunAt`); absent keys keep their current value.
 */
export function withSchedule(
  task: TaskRecord,
  patch: Partial<ScheduleRule>,
  now: number,
): TaskRecord {
  const current = task.schedule
  const schedule: ScheduleRule = {
    enabled: current?.enabled ?? false,
    mode: current?.mode ?? 'cron',
    cron: current?.cron ?? '',
    nextRunAt: current?.nextRunAt,
    lastTriggeredAt: current?.lastTriggeredAt,
    maxRuns: current?.maxRuns,
    runCount: current?.runCount ?? 0,
    missedToleranceMs: current?.missedToleranceMs,
    // Legacy activation gate: automation is active as soon as it is armed
    // (nothing awaits a manual first run), so any merged rule reads primed —
    // old data normalizes the same way in the store.
    primed: true,
  }
  if ('enabled' in patch) schedule.enabled = patch.enabled ?? false
  if ('mode' in patch) schedule.mode = patch.mode ?? 'cron'
  if ('cron' in patch) schedule.cron = patch.cron ?? ''
  if ('nextRunAt' in patch) schedule.nextRunAt = patch.nextRunAt
  if ('lastTriggeredAt' in patch) schedule.lastTriggeredAt = patch.lastTriggeredAt
  if ('maxRuns' in patch) schedule.maxRuns = patch.maxRuns
  if ('runCount' in patch) schedule.runCount = patch.runCount ?? 0
  if ('missedToleranceMs' in patch) schedule.missedToleranceMs = patch.missedToleranceMs
  return { ...task, updatedAt: now, schedule }
}

/**
 * Open a fresh execution on a task: move it to 'running' and append a
 * running execution record. Returns the new task and the new execution.
 */
export function startExecution(
  task: TaskRecord,
  now: number,
  executionId: string,
): { task: TaskRecord; execution: ExecutionRecord } {
  const execution: ExecutionRecord = {
    id: executionId,
    sessionId: undefined,
    startedAt: now,
    endedAt: undefined,
    result: undefined,
    error: undefined,
    // The row starts viewed at its own start: while it runs nothing is new
    // (the user can see it running); its settlement (or a later comment)
    // then lights the unread dot until the review page is opened.
    viewedAt: now,
  }
  return {
    task: withStatus({ ...task, executions: [...task.executions, execution] }, 'running', now),
    execution,
  }
}

/** Paused-readiness explanation keyed by the pausing status. */

/**
 * Create an externally-observed round (see `ExecutionRecord.external`): the
 * board detected native-side activity on a related session (out-of-band
 * chat). It enters the session's comment thread and drives the task state
 * like a running round, but is never queued/injected — it is already
 * happening.
 */
export function newExternalRound(options: {
  id: string
  now: number
  sessionId: string
  /** The native user message text observed at creation (the thread body). */
  text?: string
  /** The native seq of the message that started this turn (dedup anchor). */
  anchor?: number
  /** The observed message carried only image blocks (thread placeholder). */
  imageOnly?: boolean
}): ExecutionRecord {
  return {
    id: options.id,
    sessionId: options.sessionId,
    startedAt: options.now,
    endedAt: undefined,
    result: undefined,
    error: undefined,
    comment: options.text ?? '',
    sessionAnchor: options.sessionId,
    external: true,
    // Born seen at the observation instant (the recorder is looking at the
    // turn it just captured); the turn's own settlement lands later and is
    // therefore honestly NEW — the same clock comment rounds read.
    viewedAt: options.now,
    ...options.anchor !== undefined ? { anchor: options.anchor } : {},
    ...options.imageOnly === true ? { imageOnly: true } : {},
  }
}

/**
 * Whether a user-authored message carries NOTHING to deliver.
 *
 * THE one blank-message rule for every send path (queued comment, session
 * comment, rule comment, direct steer). It used to be written per path as
 * `trimmed === ''`, which quietly rejected an ATTACHMENT-ONLY message — the
 * composer accepted it (`text === '' && images.length === 0 && files.length === 0`
 * is the gate that lets it through) and the controller then returned
 * `undefined`, so the draft was restored and the user saw nothing happen at
 * all. Only the direct-steer path had it right, which is exactly how one rule
 * living in four places drifts: the picture-with-no-words case worked on one
 * surface and silently failed on the others.
 *
 * Attachments are content: text alone is not the whole message.
 * @param text - raw (untrimmed) message text.
 * @param images - images carried by the message, if any.
 * @param files - staged file refs carried by the message, if any.
 * @returns whether there is nothing to send.
 */
export function isBlankMessage(
  text: string,
  images?: readonly unknown[] | undefined,
  files?: readonly unknown[] | undefined,
): boolean {
  return text.trim() === ''
    && (images === undefined || images.length === 0)
    && (files === undefined || files.length === 0)
}

/**
 * Create a new comment-continuation round (pure): the single factory for
 * both comment anchors. An execution-anchored comment (`parentExecutionId`)
 * continues a settled run and reuses its session; a session-anchored
 * comment (`sessionAnchor`) continues a linked session and reuses that
 * session. Either way the round carries the session id it will be injected
 * into, so the dispatcher's eligibility scan and the injection hand-off work
 * unchanged — one queue, one model, two surfaces.
 */
export function newCommentRound(options: {
  id: string
  now: number
  /** The trimmed comment text. */
  text: string
  /** Whether the line is a slash command rather than a turn. */
  command?: boolean
  /** The session the comment will be injected into (reused, never created). */
  sessionId: string
  /** The settled execution this comment continues (execution-anchored). */
  parentExecutionId?: string
  /** The linked session this comment continues (session-anchored). */
  sessionAnchor?: string
  /** The session automation rule that created this round (loop marker). */
  ruleId?: string
  /** Images carried by the comment (queued sends deliver them with the text). */
  images?: readonly TaskImage[]
  /** File refs carried by the comment (queued sends deliver them with the text). */
  files?: readonly TaskFile[]
}): ExecutionRecord {
  return {
    id: options.id,
    sessionId: options.sessionId,
    startedAt: options.now,
    endedAt: undefined,
    result: undefined,
    error: undefined,
    comment: options.text,
    ...(options.command === true ? { command: true } : {}),
    ...(options.images !== undefined && options.images.length > 0
      ? { promptImages: options.images.map(image => ({ ...image })) }
      : {}),
    ...(options.files !== undefined && options.files.length > 0
      ? { promptFiles: options.files.map(file => ({ ...file })) }
      : {}),
    ...(options.parentExecutionId !== undefined ? { parentExecutionId: options.parentExecutionId } : {}),
    ...(options.sessionAnchor !== undefined ? { sessionAnchor: options.sessionAnchor } : {}),
    ...(options.ruleId !== undefined ? { ruleId: options.ruleId } : {}),
    // Born seen: the author is looking at the round they just saved. Its
    // LATER injection/settle is then genuinely new content (the per-session
    // read clock in session-display reads activity > acknowledgment), and
    // storage backfill can never mark a live round as read by accident.
    viewedAt: options.now,
  }
}

/**
 * Create a direct-send round (直发模式): the message was already delivered to
 * the native session, so the round is settled-succeeded at birth — it exists
 * to make the line visible in the session's comment thread (next to drive
 * comments and execution comments), never to queue or drive anything.
 */
export function newDirectRound(options: {
  id: string
  now: number
  /** The trimmed message text that was sent. */
  text: string
  /** The native session the message was sent to. */
  sessionId: string
}): ExecutionRecord {
  return {
    id: options.id,
    sessionId: options.sessionId,
    startedAt: options.now,
    endedAt: options.now,
    result: 'succeeded',
    error: undefined,
    comment: options.text,
    sessionAnchor: options.sessionId,
    direct: true,
  }
}

/**
 * Whether the card already holds completed work awaiting the human gate:
 * any settled round with a succeeded/failed outcome (plain runs,
 * comment continuations, externally-observed turns, direct sends — all are
 * completions the user has not confirmed). Cancelled rounds never count:
 * they are noise/abort, not work.
 * Used ONLY to decide where a `cancelled` settle lands (review vs todo) —
 * success/failure always land in review (or stay running for incomplete
 * batches/chains or sibling lanes).
 */
export function hasCompletedWork(task: TaskRecord): boolean {
  return task.executions.some(round =>
    round.endedAt !== undefined
    && (round.result === 'succeeded' || round.result === 'failed'))
}

/**
 * THE one column decision for every settle (success/failure/
 * cancel). Pure so the whole board — live watches, reconciles, watchdogs,
 * spurious-external sweeps — lands in the same column for the same facts.
 * Priority:
 * 0. another lane still open, or a related session still working → `running`
 *    (the column and the card's light both read this one fact: a card whose
 *    session is working must never be written out of 进行中 — the yellow
 *    border without the breath AND the "settled while the subagent still
 *    runs" bug are the same disagreement);
 * 1. succeeded/failed → `review` (chain/batch incomplete stays `running`);
 * 2. cancelled → keep a parked column as-is; from `running`, return to
 *    `review` when completed work exists (the human gate survives noise),
 *    else `todo` (nothing completed — back to the queue).
 * `stillWorking` is the ACTIVITY leg (`taskLiveStateOf(...) === 'running'`,
 * i.e. this session's own turn or a running subagent descendant — see
 * session-activity.ts). It is a separate parameter from `othersOpen` on
 * purpose: `othersOpen` counts THIS CARD's other open rounds, while the
 * activity leg is the native truth about the related sessions. Folding one
 * into the other is how the two readings drift apart again.
 */
export function settleColumnOf(
  task: TaskRecord,
  outcome: 'succeeded' | 'failed' | 'cancelled',
  othersOpen: boolean,
  chainIncomplete: boolean,
  batchIncomplete: boolean,
  stillWorking = false,
): TaskStatus {
  if (othersOpen || stillWorking) return 'running'
  if (outcome === 'cancelled') {
    if (task.status !== 'running') return task.status
    return hasCompletedWork(task) ? 'review' : 'todo'
  }
  if (chainIncomplete || batchIncomplete) return 'running'
  return 'review'
}

/**
 * Settle a running execution: record the outcome on the NAMED round (any
 * round of the card can be the one finishing — a card may run several
 * sessions at once) and move the card into the column its whole set of
 * sessions adds up to. No-op (returns the input task) when the round is
 * unknown or already settled.
 *
 * A settled run always lands in 'review' — the human gate between execution
 * and completion: succeeded runs await human confirmation, failed runs await
 * a decision (comment to steer, rerun, or move on). The only exception is a
 * scheduled batch that keeps the card 'running' between runs: a succeeded
 * run belonging to an armed schedule whose next automatic run is still to
 * come stays 'running' — for a budgeted cron batch (`runCount < maxRuns`:
 * the scheduler increments the counter at fire-accept, before the run can
 * settle, so a just-settled scheduled run is already counted) and for chain
 * mode (`runCount + 1 < maxRuns`: the hand-off increments the counter when
 * it launches the NEXT run, while the armed first run is never counted, so
 * a just-settled run is one behind; unlimited chains always stay 'running').
 * A cancelled run returns to 'todo' ONLY when the card holds no completed
 * work; with prior success/failure it lands in 'review' (noise must never
 * swallow the human gate — see `settleColumnOf`).
 *
 * `stillWorking` is the caller's ACTIVITY leg for the related sessions (own
 * turn or a running subagent descendant — the one derivation in
 * session-activity.ts), and it is POSITIVE evidence only: an incomplete
 * snapshot verdict must not hold a settle (the round has its own turn
 * evidence; "no verdict" only ever prevents a LEAVE). The ROUND always settles
 * on its own turn's evidence (I3: a descendant never extends a round's
 * deadline); what waits for the work to end is the COLUMN, and the sweep that
 * finally lands it reads the same leg.
 */
export function settleExecution(
  task: TaskRecord,
  executionId: string,
  outcome: 'succeeded' | 'failed' | 'cancelled',
  now: number,
  error: string | undefined,
  stillWorking = false,
): TaskRecord {
  const index = task.executions.findIndex(execution => execution.id === executionId)
  if (index === -1) return task
  const execution = task.executions[index]
  if (execution.endedAt !== undefined) return task
  const settled: ExecutionRecord = { ...execution, endedAt: now, result: outcome, error }
  const executions = [...task.executions]
  executions[index] = settled
  const schedule = task.schedule
  const chainIncomplete = outcome === 'succeeded'
    && schedule !== undefined
    && schedule.enabled
    && schedule.mode === 'chain'
    && (schedule.maxRuns === undefined || schedule.runCount + 1 < schedule.maxRuns)
  // Cron keeps the card running while fewer than maxRuns scheduled fires have
  // launched. The counter already counts THIS run (the scheduler persisted the
  // increment at fire-accept); the +1 form would land the penultimate run in
  // review and the next tick would then skip the final fire via the column
  // pause — the batch would silently run one run short.
  const batchIncomplete = outcome === 'succeeded'
    && schedule !== undefined
    && schedule.enabled
    && schedule.mode === 'cron'
    && schedule.maxRuns !== undefined
    && schedule.runCount < schedule.maxRuns
  // ANOTHER of this card's sessions still working? The card stays 进行中:
  // settling one lane must not yank it into 待审核/待办 while a second
  // conversation it owns is running (the column aggregates its sessions, it
  // is not a record of the last round to finish).
  const othersOpen = openRoundsOf({ ...task, executions }).length > 0
  const status = settleColumnOf(task, outcome, othersOpen, chainIncomplete, batchIncomplete, stillWorking)
  return withStatus({ ...task, executions }, status, now)
}

/**
 * Whether ONE round is genuinely in flight (someone is working on it right
 * now), as opposed to saved-and-waiting or already settled. The single
 * structural judgment behind `openRoundsOf` — derived from the round itself,
 * never from the card's column, so a card parked mid-flight still reports the
 * work that is really running.
 *
 * Enumerated by KIND (each category is real, and a comment body does NOT mean
 * "queued" — an observed native turn carries its user text too):
 * - a plain run: in flight from creation until it settles;
 * - an EXTERNAL round (a native turn the board observed): in flight while
 *   open — it is already happening, it is never queued or injected, and its
 *   `comment` is only the thread body;
 * - a comment round: in flight only ONCE INJECTED. A saved comment is queued
 *   — it must never show a spinner, block a rerun, hold a slot or mark its
 *   session busy.
 */
export function isOpenRound(round: ExecutionRecord): boolean {
  if (round.endedAt !== undefined) return false
  if (round.external === true) return true
  if (round.comment !== undefined) return round.injectedAt !== undefined
  return true
}

/** Every in-flight round of a task, in submission order. THE truth the
 *  dispatcher, the budget and the column state machine all read — a card may
 *  legitimately run several sessions at once (one lane per session), so
 *  "the task's latest execution" is no longer the only thing that can be
 *  running. */
export function openRoundsOf(task: TaskRecord): ExecutionRecord[] {
  return task.executions.filter(isOpenRound)
}

/** Whether a given session of the task is busy (an in-flight round anchored
 *  to it). A comment may only inject into a session that is idle, and a
 *  session's own comments always go in order — the lane is the session. */
export function sessionIsBusy(task: TaskRecord, sessionId: string): boolean {
  return task.executions.some(round => isOpenRound(round) && round.sessionId === sessionId)
}

/**
 * Whether the task is genuinely executing right now: ANY of its rounds is in
 * flight. A pending comment round (saved while the cruise is off, the task
 * not running) is NOT an open run — it must never show a spinner on the card,
 * block a rerun, or block a drag.
 * One shared judgment for the card, the drop rules and the run guard.
 */
export function hasOpenRun(task: TaskRecord): boolean {
  return openRoundsOf(task).length > 0
}

/**
 * How many comment rounds of a task are saved but not yet injected (the
 * task's comment queue). These wait for the dispatcher — the budget, the
 * cruise toggle, or the task's own busy round — and can be cancelled.
 */
export function pendingCommentCount(task: TaskRecord): number {
  let count = 0
  for (const round of task.executions) {
    // External rounds run out-of-band and are never queued — they must not
    // count toward the "saved comments waiting to inject" badge.
    if (round.comment !== undefined && round.injectedAt === undefined && round.endedAt === undefined && round.external !== true) count += 1
  }
  return count
}

/**
 * The task's plain runs in chronological order — every execution record
 * except comment rounds. The single numbering source for the
 * execution history list (TaskDetail) and the review page header ("第 N 次
 * 执行"): continuations are not part of the run sequence.
 */
export function plainRunsOf(task: TaskRecord): readonly ExecutionRecord[] {
  return task.executions.filter(execution => execution.comment === undefined)
}

/**
 * Whether the task is genuinely EXECUTING right now (display truth): an open
 * plain run, external round or injected comment.
 * Blocking semantics (run guard, concurrency budget, drop rules, reconcile
 * drive) stay on {@link hasOpenRun} — this is display only, never a gate.
 */
export function executing(task: TaskRecord): boolean {
  return task.executions.some(isOpenRound)
}

/** What a card drop onto a column means (drag-and-drop decision). */
export type CardDropDecision =
  | { kind: 'none' }
  | { kind: 'move'; status: TaskStatus }
  | { kind: 'run' }
  | { kind: 'reject'; reason: 'busy' }

/**
 * Decide what dropping a card onto a column does, reconciling the manual
 * move with the execution owner. Automation is never a drop obstacle: a
 * chain card is freely movable — "leaving the lane" is expressed as a
 * pause/stop in the controller's moveTask, never as a rejection here.
 * - Dropping on 'running' reruns the task (the same "run again" semantics
 *   as the detail button); a live run is a no-op/reject, shared with every
 *   other surface.
 * - While an execution is open, 'review'/'done' are refused: the runner
 *   owns those transitions and would overwrite a manual move when the run
 *   settles.
 * - Anything else is a plain manual move; dropping on the current column is
 *   a no-op (except 'running' via the rerun rule above).
 */
export function resolveCardDrop(task: TaskRecord, target: TaskStatus): CardDropDecision {
  const busy = hasOpenRun(task)
  if (target === 'running') {
    if (!busy) return { kind: 'run' }
    if (task.status === target) return { kind: 'none' }
    return { kind: 'reject', reason: 'busy' }
  }
  if (task.status === target) return { kind: 'none' }
  if (busy && (target === 'review' || target === 'done')) return { kind: 'reject', reason: 'busy' }
  // Leaving 进行中 while ANY of its rounds is still open would ORPHAN that
  // round: no surface settles a parked card's plain run, so the zombie would
  // hold a concurrency slot and (through the open-round gate on external
  // recording) swallow every future native turn of its session — one drag used
  // to be enough to break the card permanently. The runner settles; then it
  // moves. (The judgment is `busy`, i.e. "any round in flight" — testing the
  // LAST record here was the single-lane assumption: with several sessions
  // running, the open one is often not the newest row.)
  if (task.status === 'running' && busy) {
    return { kind: 'reject', reason: 'busy' }
  }
  return { kind: 'move', status: target }
}

/**
 * 本栏当前的渲染顺序（自上而下）：按 `order` 键排序，键相同时保持台账数组
 * 顺序——渲染层用的是稳定排序 `sort((a, b) => a.order - b.order)`，所以键序
 * 就是屏幕上的顺序。**唯一**读法：数组位置不是顺序，`order` 键才是。
 */
function renderedColumnIds(tasks: readonly TaskRecord[], status: TaskStatus): string[] {
  return tasks
    .filter(task => task.status === status)
    .sort((a, b) => a.order - b.order)
    .map(task => task.id)
}

/** 一次改顺序之后的落位结果：哪个栏、哪张卡、排第几。 */
type OrderPlan = ReadonlyMap<TaskStatus, ReadonlyArray<{ id: string; order: number }>>

/**
 * 空转判据：动作后的「栏位 + 键」赋值与动作前一模一样，就一个记录都不碰——
 * 不刷新 `updatedAt`、不抢作者归属、不产生同步抖动。两个改顺序的函数共用这
 * 一条律。
 *
 * 它看的是**赋值**，不是某张卡的键是不是 0。这一点是命门：一次跨栏落地时，
 * 落地卡手里攥着的键来自它**原来那一栏**（刚被顶到「进行中」顶部的卡，键就
 * 是 0）。拿自己的键当守卫，跨栏必然误判成空转——卡片不落顶格，同栏位也不
 * 让位，键相同时由数组顺序决定，看起来就是「顶了个寂寞」。
 */
function orderUnchanged(tasks: readonly TaskRecord[], plan: OrderPlan): boolean {
  const byId = new Map(tasks.map(task => [task.id, task]))
  for (const [status, rows] of plan) {
    for (const row of rows) {
      const current = byId.get(row.id)
      if (current === undefined || current.status !== status || current.order !== row.order) return false
    }
  }
  return true
}

/**
 * Move a card into a column at a given position, renumbering the target
 * column's sort keys. `beforeId` inserts before that card (undefined =
 * column tail); a same-column move removes the card first, so the insertion
 * index is naturally off-by-one safe. Only the target column's orders are
 * rewritten — other columns keep their relative order (gaps are harmless,
 * since sorting only compares within a column).
 *
 * THE order-key invariant: the ARRAY order is never trusted — only the `order`
 * keys are truth, because the store keeps array positions while every render
 * sorts by key. Splicing against raw array order lands the card at a visually
 * wrong gap, defeats the same-spot check (phantom updatedAt churn on every
 * sibling → sync storms and whole-column FLIP flashes), and scrambles the
 * column on the next drag. Both lists below are key-sorted first — the same
 * law the promotion below already follows.
 */
export function applyCardOrder(
  tasks: readonly TaskRecord[],
  movedId: string,
  targetStatus: TaskStatus,
  beforeId: string | undefined,
  now: number,
): TaskRecord[] {
  const moved = tasks.find(task => task.id === movedId)
  if (moved === undefined) return [...tasks]
  // Moving a card before itself is a no-op (the card was already removed
  // from the target list, so it could never be found as an anchor).
  if (beforeId === movedId) return [...tasks]
  const others = tasks.filter(task => task.id !== movedId)
  const target = others
    .filter(task => task.status === targetStatus)
    .sort((a, b) => a.order - b.order)
  const at = beforeId === undefined ? target.length : target.findIndex(task => task.id === beforeId)
  const position = at < 0 ? target.length : at
  const ordered = [...target.slice(0, position), moved, ...target.slice(position)]
  // Same-spot drop: the target column reads identically with the card in
  // place — return untouched (no updatedAt bump, no authorship claim, no
  // sync churn for a no-op). Same law, same judgment as the promotion below.
  if (orderUnchanged(tasks, new Map([[targetStatus, ordered.map((row, order) => ({ id: row.id, order }))]]))) {
    return [...tasks]
  }
  return tasks.map(task => {
    if (task.id === movedId) {
      // Column moves funnel through withStatus (status history appends here —
      // the one funnel for every hand that changes columns).
      return withStatus(
        { ...task, order: ordered.findIndex(row => row.id === task.id) },
        targetStatus,
        now,
      )
    }
    if (task.status === targetStatus) {
      // A shifted sibling is a moved record: its order CONTENT changed, so it
      // carries the stamp too (an un-stamped order write loses the sync
      // merge — the two-device order-drift class, closed on the pushed side).
      const order = ordered.findIndex(row => row.id === task.id)
      return order === task.order ? task : { ...task, order, updatedAt: now }
    }
    return task
  })
}

/**
 * 把若干张卡片顶到各自那一栏的最上方——「最新状态在前」这条律的唯一实现。
 *
 * 单张（{@link promoteToColumnTop}）与批量是同一个函数：批量只是把 entries
 * 排成一串，一次把整栏重排一次号。分批提升会让同门被反复改写 k 次——1000 张
 * 卡的栏里一次落 20 张，同门就被改写两万次，同步载荷暴涨。
 *
 * `entries` 按**发生顺序**给出（旧的在前，调用方自己掌握先后），所以倒过来
 * 就是「最新发生的在最上」：一次落 k 张，屏幕上从上到下读作「后完成的在上」，
 * 与逐张提升的结果完全一致。一张卡在一次调用里只出现一次。
 *
 * 落地与排序都在这里收口：落地卡经 `withStatus` 换栏（跨栏时由它追加历史），
 * 被让位的同门只改键。两者都算「记录变了」，都盖章——同步合并按 updatedAt
 * 排序，漏盖就是两台设备顺序漂移。别的栏一根键都不碰。
 */
export function promoteManyToColumnTop(
  tasks: readonly TaskRecord[],
  entries: ReadonlyArray<{ id: string; status: TaskStatus }>,
  now: number,
): TaskRecord[] {
  const known = new Set(tasks.map(task => task.id))
  // 落地卡按栏分组，保持 entries 的先后（= 发生顺序）。
  const landedByColumn = new Map<TaskStatus, string[]>()
  for (const entry of entries) {
    if (!known.has(entry.id)) continue
    const landed = landedByColumn.get(entry.status)
    if (landed === undefined) landedByColumn.set(entry.status, [entry.id])
    else if (!landed.includes(entry.id)) landed.push(entry.id)
  }
  if (landedByColumn.size === 0) return [...tasks]

  // 目标顺序 = 落地卡（发生时间倒序，所以最新完成的在最上）+ 其余成员保持原有
  // 相对顺序跟在后面。
  const plan = new Map<TaskStatus, ReadonlyArray<{ id: string; order: number }>>()
  for (const [status, landed] of landedByColumn) {
    const current = renderedColumnIds(tasks, status)
    const next = [...landed].reverse().concat(current.filter(id => !landed.includes(id)))
    plan.set(status, next.map((id, order) => ({ id, order })))
  }
  // 落位后与落位前的赋值一模一样 = 整件事没发生：一个记录都不碰。
  if (orderUnchanged(tasks, plan)) return [...tasks]

  const rank = new Map<TaskStatus, Map<string, number>>()
  for (const [status, rows] of plan) rank.set(status, new Map(rows.map(row => [row.id, row.order])))
  const landedStatus = new Map<string, TaskStatus>()
  for (const [status, landed] of landedByColumn) for (const id of landed) landedStatus.set(id, status)
  return tasks.map(task => {
    // 落地的那张：换栏走 withStatus（换栏历史在这里追加，状态没变时只刷新
    // updatedAt），键落到它在本栏的新名次。
    const to = landedStatus.get(task.id)
    if (to !== undefined) return withStatus({ ...task, order: rank.get(to)?.get(task.id) ?? 0 }, to, now)
    // 被让位的同门：键的内容变了，所以也盖章（漏盖就是两台设备顺序漂移）。
    const order = rank.get(task.status)?.get(task.id)
    if (order === undefined || order === task.order) return task
    return { ...task, order, updatedAt: now }
  })
}

/**
 * Promote a card to the TOP of its column — the "newest state first" rule:
 * a task that just entered a column (freshly created, newly bound from the
 * workspace, or passing through a status change) reads as the newest item
 * of that column. Existing cards shift down, preserving their relative
 * order; a manual reorder later overrides the promotion. Only the target
 * column's orders are rewritten.
 *
 * 单张入口，实现就是 {@link promoteManyToColumnTop} 的一次调用——批量不是第二
 * 套做法，只是把 entries 排成一串。
 */
export function promoteToColumnTop(
  tasks: readonly TaskRecord[],
  movedId: string,
  targetStatus: TaskStatus,
  now: number,
): TaskRecord[] {
  return promoteManyToColumnTop(tasks, [{ id: movedId, status: targetStatus }], now)
}
