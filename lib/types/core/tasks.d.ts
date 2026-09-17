/**
 * Task board domain model: task lifecycle statuses, the task record shape,
 * and the pure transition functions the controller and tests share.
 * Framework-free (no cordis, no runtime imports) so the state machine is
 * unit-testable in isolation.
 */
/** Task lifecycle status, one per kanban column. */
export type TaskStatus = 'backlog' | 'todo' | 'running' | 'review' | 'done';
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
    id: string;
    /** The dsh session that ran this attempt; absent until creation resolves. */
    sessionId: string | undefined;
    /** When the run started (ms epoch). */
    startedAt: number;
    /** When the run settled; absent while still running. */
    endedAt: number | undefined;
    /** Outcome once settled. */
    result: 'succeeded' | 'failed' | 'cancelled' | undefined;
    /** Human failure text when the run failed (prompt rejection or agent error). */
    error: string | undefined;
    /** The comment text when this round is a comment continuation (absent = a plain run). */
    comment?: string;
    /**
     * Images attached to a comment round (the same base64 wire shape as a task
     * prompt image). A QUEUED comment carries its pictures on the round so the
     * dispatcher sends text + images together when the lane frees — the send
     * mode (排队 vs 插话) is the user's choice and is NEVER overridden by the
     * mere presence of images.
     */
    promptImages?: TaskImage[];
    /**
     * File refs attached to a comment round (the OFFICIAL `{type:'file',
     * receiptId}` shape). Same queueing as images: a QUEUED comment carries
     * its files on the round so the dispatcher sends text + files together
     * when the lane frees.
     */
    promptFiles?: TaskFile[];
    /**
     * When the user last opened this execution's review page (ms epoch),
     * clearing its unread reminder. Absent on legacy rows — the display layer
     * falls back to the run's own latest activity, so old content never lights
     * up as unread after an upgrade.
     */
    viewedAt?: number;
    /**
     * Whether this comment round is a slash command rather than a turn: the
     * line is executed through the native command registry (never delivered
     * to the model as text). Unknown commands fall back to plain text.
     */
    command?: boolean;
    /**
     * When a comment continuation was actually injected into its session (ms
     * epoch). Absent = the comment is still saved/queued and can be cancelled;
     * present = the session is (or was) running it and the round can only be
     * observed.
     */
    injectedAt?: number;
    /**
     * The plain execution this comment round continues (the record whose
     * review page the comment was submitted from; its session is reused).
     * Present on rounds created after this field existed; older persisted
     * rounds omit it and are attributed by session instead. Comment rounds
     * only ever carry it — plain runs never do.
     */
    parentExecutionId?: string;
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
    sessionAnchor?: string;
    /**
     * The session automation rule this comment round was created by (preset
     * instruction / 完成后续跑 loop). A settled rule round with a SUCCEEDED
     * outcome re-fires its owning on-complete rule — the 完成后续跑 loop — so
     * the rule keeps repeating after each turn it triggered; rounds without a
     * ruleId (or with a failed outcome) never re-fire anything, so no storm.
     */
    ruleId?: string;
    /**
     * A direct-send round: a message the user sent straight to the native
     * session (直发模式) — recorded so it appears in the session's comment
     * thread next to drive comments and execution comments, but never queued,
     * injected or driven (it is already delivered: `endedAt` and `result` are
     * set at creation, there is no `injectedAt`). Purely a thread record —
     * task state, dispatcher and queues ignore it.
     */
    direct?: boolean;
    /**
     * A requirement-refinement round: one turn in the task's bound refine
     * session (see `TaskRecord.refineSessionId`) that researches and fleshes
     * out the task's prompt. Distinct from plain runs and comment rounds: it
     * never appears in the execution history or the comment thread, and its
     * settlement never moves the task out of its column.
     */
    refine?: boolean;
    /**
     * An externally-observed round: the task's related session had real
     * activity OUTSIDE the board (a user chatted directly in the native UI,
     * or the agent did something the board did not record) — detected from the
     * session list's running flip. Unlike comment/direct rounds it is
     * populated by observation, not submission: it drives the card into 「进行中」
     * and settles to 「待审核」 like a real round, appears in the session's
     * comment thread (its text is filled at settle when history yields it),
     * but is NEVER queued or injected (it is already running out-of-band), and
     * a refine-external round keeps the task in its column while `refining`.
     */
    external?: boolean;
    /**
     * An externally-observed round whose latest native user message carried NO
     * text (a picture-only message): the thread shows the 图片消息 placeholder
     * instead of a state word dressed up as content — never stale text from an
     * older message.
     */
    imageOnly?: boolean;
    /**
     * The native log seq of the user message that started an externally-observed
     * turn — THE turn anchor. Both detection channels (the live frame and
     * the reconcile state backstop) dedup on it, across passes, devices and
     * engine handovers: the same native turn is never recorded twice, and a
     * reload cannot lose the "already recorded this turn" fact.
     */
    anchor?: number;
}
/** How a scheduled task is driven: cron = fire at fixed times; chain = rerun right after each run settles. */
export type ScheduleMode = 'cron' | 'chain';
/** A live binding to ONE native source — a session or a whole workspace
 *  folder. A task may hold several (each drag-in ADDS one, never replaces). */
export type TaskBind = {
    kind: 'session';
    sessionId: string;
} | {
    kind: 'workspace';
    workspaceId: string;
};
/** The task's live bindings: the multi-source list, with the legacy single
 *  `bind` field projected as a one-element list (old data parses untouched).
 *  EVERY reader goes through here — never the raw field. */
export declare function taskBindsOf(task: TaskRecord): TaskBind[];
/** Whether two bindings name the SAME source (same kind, same id). */
export declare function sameBind(a: TaskBind, b: TaskBind): boolean;
/** The card's source-line label — ONE derivation for every card: the bound
 *  session's title when the task has a session source and that title differs
 *  from the task's own title (a source named exactly like the task is the
 *  task itself — never a repeated line), else the workspace label, skipped
 *  the same way. Empty = no source line (the card shows no source, never a
 *  guessed default). Callers pass the RESOLVED titles (live titles, raw ids
 *  as fallback); this is pure display policy. */
export declare function cardSourceLabel(task: TaskRecord, boundTitle: string, workspaceTitle: string): string;
/** Brand an unknown string as a schedule mode. */
export declare function isScheduleMode(value: unknown): value is ScheduleMode;
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
    enabled: boolean;
    /** Driving mode; defaults to 'cron' (legacy rules normalize to it). */
    mode: ScheduleMode;
    /** 5-field cron expression: `分 时 日 月 周` (cron mode). */
    cron: string;
    /** Next due instant (ms epoch); maintained by the scheduler/controller (cron mode). */
    nextRunAt: number | undefined;
    /** Instant of the latest scheduled trigger (ms epoch). */
    lastTriggeredAt: number | undefined;
    /** How many scheduled runs may fire in total; undefined = unlimited. */
    maxRuns: number | undefined;
    /** How many scheduled runs have fired so far (monotone; automatic triggers only). */
    runCount: number;
    /**
     * Missed-slot tolerance (ms) for superseded due instants: when a newer cron
     * grid point already passed AND the due instant is older than this, the slot
     * is skipped without catch-up (a slept tab never avalanches). A merely-late
     * tick still fires. Undefined = one scheduler tick. Old rules read it as
     * undefined (same default), so no migration is needed.
     */
    missedToleranceMs?: number;
    /**
     * Legacy activation gate: automation now fires as soon as it is armed —
     * there is no "manual run first" step (see {@link ruleReadiness}). Kept on
     * the persisted shape so old data parses; every load/merge normalizes it
     * to true, so no live code ever sees it as false.
     */
    primed: boolean;
}
/** One task on the board. */
/** One image attached to a task's execution prompt — the same base64 shape
 *  the native `PromptContentPart` image variant carries (the host admits the
 *  bytes durably when it takes the prompt). */
export interface TaskImage {
    mediaType: string;
    /** Canonical base64 (no data-URL prefix). */
    data: string;
    name?: string;
}
/** One file ref attached to a task's execution prompt — the OFFICIAL
 *  `{type:'file', receiptId}` shape (files carry no admission limits; the
 *  stored object is the exact submitted bytes). Queued like images: a file
 *  staged for a session rides the round until the lane frees. */
export interface TaskFile {
    receiptId: string;
    name: string;
    bytes: number;
}
export interface TaskRecord {
    /** Stable task id (uuid). */
    id: string;
    /** Short display title. */
    title: string;
    /** Longer human description shown in the detail view. */
    description: string;
    /** The prompt sent to dsh when this task is executed. */
    prompt: string;
    /**
     * Images attached to the execution prompt — the OFFICIAL temporary-bytes
     * image shape (base64 + media type), PERSISTED with the task so EVERY run
     * path (manual / scheduled / cruise / chain / rerun) sends the same
     * picture-text prompt. Deliberately tiny by contract: the browser
     * compresses each image hard before it lands here and the form caps the
     * count (this rides the shared board document to every device). Absent =
     * a text-only prompt (the overwhelming majority of tasks).
     */
    promptImages?: TaskImage[];
    /**
     * File refs attached to the execution prompt — the OFFICIAL
     * `{type:'file', receiptId}` shape, PERSISTED with the task like images.
     * Receipts are staged per-Agent: a receipt minted for one session MUST be
     * re-staged before a run on another session (the send layer re-uploads by
     * name when the stored receipt is rejected — files are re-readable from
     * the composer's staged bytes, never re-asked from the user).
     */
    promptFiles?: TaskFile[];
    /** Current column. */
    status: TaskStatus;
    /** Column-move history (newest last; the creation column is the first
     *  entry): every real transition appends here through withStatus (the one
     *  funnel — startExecution/settle/applyCardOrder all read it). Absent on
     *  legacy rows (treated as "always this column"). Human-scale: moves are
     *  manual acts, so no cap is needed — the array stays tiny.
     */
    statusHistory?: Array<{
        status: TaskStatus;
        at: number;
    }>;
    /** Column sort key (ascending; legacy rows are normalized on load). */
    order: number;
    /** Creation instant (ms epoch). */
    createdAt: number;
    /** Last mutation instant (ms epoch). */
    updatedAt: number;
    /** Every execution attempt, most recent last. */
    executions: ExecutionRecord[];
    /** Optional scheduled-run rule (absent on tasks without a schedule). */
    schedule?: ScheduleRule;
    /** Per-task run configuration (absent fields fall back to defaults). */
    workspaceId?: string;
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    /** Agent preset to compose the execution session from (absent = deployment default). */
    agentPreset?: string;
    /** Permission preset key applied to the execution session before its first prompt (absent = session default). */
    permission?: string;
    /** The task's bound requirement-refinement session (created lazily on the
     * first refine round and reused for every later round — the whole
     * refinement conversation lives in one session). The task's run
     * configuration applies to it, so nothing needs configuring.
     */
    refineSessionId?: string;
    /**
     * Live bindings to native sources — sessions and/or whole workspace folders
     * (dragged in from the sidebar, one ADD at a time). The set decides the
     * source of the card's "链接会话" (linked sessions) section — a pure,
     * live-synced view of every bound source's sessions (same session yields
     * one row) — and nothing else: the card keeps its own title, description,
     * prompt, run config, scheduling, executions and refinement exactly as a
     * plain task. Absent = a plain prompt-driven task (the pre-bind behavior).
     */
    binds?: TaskBind[];
    /** Legacy single-source binding (pre multi-bind). Kept so old data parses;
     *  every reader goes through {@link taskBindsOf} — never read directly. */
    bind?: TaskBind;
    /**
     * Display-only row hiding sets — rows the user chose not to see, neither
     * deleted nor archived (hiding keeps task numbering stable). `executions`
     * holds execution-record ids, `sessions` holds linked-session ids. The
     * "同步 / 恢复全部已隐藏" actions clear the relevant set.
     */
    hidden?: {
        executions?: string[];
        sessions?: string[];
    };
    /**
     * Sessions PERMANENTLY removed from this task (the hidden tray's irreversible
     * 删除). Unlike {@link hidden}, a removed session can never re-derive from a
     * bound workspace — deleting a workspace member must not resurrect it. The
     * execution rounds of a removed session are also gone; the task itself and
     * every other session stay. Absent = nothing removed.
     */
    removedSessions?: string[];
    /**
     * The user's manual order of the 会话 list (sessionIds, top first). Written
     * only after the user re-orders rows by drag; rows outside the array (new
     * sessions from a bind, a fresh run or a rerun) keep landing at the TOP
     * (newest-activity-first), so "拖进来的/重跑的都排最上面" stays true unless
     * the user drags them. Absent = the default newest-activity order.
     */
    sessionsOrder?: string[];
    /**
     * When the user last opened this task's detail (ms epoch), clearing the
     * card's unread reminder. Absent on legacy rows — the display layer falls
     * back to the task's newest round activity, so already-seen content stays
     * quiet after an upgrade. New tasks start viewed at their creation.
     */
    viewedAt?: number;
    /**
     * A per-card accent color (hex string, applied as an inline tint — data,
     * never a CSS literal). Absent = no accent.
     */
    color?: string;
    /**
     * Session automation rules — scheduled "send a preset instruction to one
     * of this task's sessions" rules (see automation.ts). Absent = none.
     */
    rules?: import('./automation.ts').SessionRule[];
}
/** Input for creating a task. */
export interface NewTaskInput {
    title: string;
    description: string;
    prompt: string;
    /** Images attached to the execution prompt (already compressed by the
     *  browser intake; capped in count by the form). */
    promptImages?: TaskImage[];
    /** File refs attached to the execution prompt (receipt shape — the twin
     *  lane of images: every birth/copy/template/draft path carries both or
     *  documents why not, never one silently). */
    promptFiles?: TaskFile[];
    /** Landing column; defaults to 'todo'. Any column is legal — an external
     *  sidebar drop lands in exactly the column it was dropped into. */
    status?: TaskStatus;
    workspaceId?: string;
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    agentPreset?: string;
    permission?: string;
    /** Accent color (hex string data, never CSS); absent = no accent. */
    color?: string;
}
/** The five kanban columns, in display order. */
export declare const COLUMNS: readonly {
    status: TaskStatus;
    label: string;
}[];
/** Statuses a user may move a card to manually (execution states are owned by the runner). */
export declare const MANUAL_STATUSES: readonly TaskStatus[];
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
export declare function adjacentStatus(status: TaskStatus, direction: -1 | 1): TaskStatus | undefined;
/** All valid statuses (closed union guard). */
export declare const ALL_STATUSES: readonly TaskStatus[];
/** Brand an unknown string as a status; undefined when it is not one. */
export declare function isTaskStatus(value: unknown): value is TaskStatus;
/**
 * The landing column of a task created by an external sidebar drop: the
 * column the item was dropped into — all five columns are respected, so a
 * drop on 进行中 / 待审核 / 已完成 stays exactly where it landed.
 */
export declare function landingStatusOf(dropStatus: TaskStatus): TaskStatus;
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
export type RuleReadiness = {
    kind: 'disabled';
} | {
    kind: 'blocked';
} | {
    kind: 'paused';
    status: 'backlog' | 'review' | 'done';
} | {
    kind: 'active';
};
/**
 * Whether the task has anything EXECUTABLE to drive: its execution prompt is
 * non-empty (trimmed). THE one judgment every drive path reads — a task with
 * no prompt can never be run, automated, cruised or comment-driven (the
 * refine flow itself is the exception: it PRODUCES the prompt, it does not
 * execute it). Empty means strictly blank; placeholder text is not empty.
 */
export declare function taskExecutable(task: TaskRecord): boolean;
/**
 * 真执行自动补全（缺则补、填则守、任何执行时刻）：新建任务允许
 * 标题/描述全空——**任何一次**真正执行（手动/重复/接续链/定时/巡航/自动化）
 * 时，缺什么补什么；已存在的字段永不覆盖（用户内容保真——「不会再动」=
 * 已填的不动，缺的补齐）。评论轮/完善轮/外源轮不是任务执行，不触发。
 * 标题缺 → 执行 Prompt 的第一个非空行（trim + 40 字符上限）；
 * 描述缺 → 整个执行 Prompt（trim）。
 * 返回需要补的字段（无则 undefined）。
 */
export declare function supplementLaunchFields(task: TaskRecord): {
    title?: string;
    description?: string;
} | undefined;
/**
 * Whether the task's COLUMN currently allows automation to run. One shared
 * judgment for EVERY automation kind — the task-level schedule rule and the
 * session-level rules read the same set: only todo/running are drivable;
 * backlog (shelved), review (a human decision is pending) and done
 * (completed) pause whichever rule armed them.
 */
export declare function taskColumnAllowsAutomation(task: TaskRecord): boolean;
/** The readiness of a task's schedule rule (see {@link RuleReadiness}). */
export declare function ruleReadiness(task: TaskRecord): RuleReadiness;
/**
 * Disarm a task's schedule rule for good — the completed-task shut-off. The
 * rule's identity (cron expression, mode, budget, prime, counters) is kept
 * so re-arming it later resumes from the same configured behavior; only
 * `enabled` and the pending `nextRunAt` are cleared. A no-op on tasks with
 * no rule or an already-disarmed one.
 */
export declare function disarmSchedule(task: TaskRecord, now: number): TaskRecord;
/** Whether a manual move target is allowed from the given status. */
export declare function canMoveManually(_from: TaskStatus, to: TaskStatus): boolean;
/**
 * The task's latest execution (rounds are appended chronologically). The ONE
 * "what's the newest round" derivation every surface reads — the card's
 * settled chip, the board's waiting probe, the detail's failure hint.
 */
export declare function latestExecutionOf(task: TaskRecord): ExecutionRecord | undefined;
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
export declare function lastPlainResult(task: TaskRecord): ExecutionRecord['result'];
/**
 * Whether arming a chain rule needs the one-shot "endless loop" confirmation:
 * an unlimited chain (no run budget) keeps firing real agent sessions until a
 * run fails or the user stops it. One guard, shared by every surface that can
 * arm a chain (the detail editor and the overview's enable switch) — a second
 * surface must never re-derive this decision.
 */
export declare function chainUnlimited(mode: ScheduleMode | undefined, maxRuns: number | undefined): boolean;
/** Admitted image media types (the INTAKE gate reads this — new uploads
 *  outside it are rejected or transcoded at the door; stored rows are
 *  grandfathered, see below). */
export declare const IMAGE_MEDIA_TYPES: readonly ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** Whether a raw value is a storable prompt image (non-empty data + a media
 *  type string). Deliberately LENIENT (no whitelist): storage walls must
 *  never retroactively delete what an older version stored — the whitelist
 *  gates new intake and the send layer, never the ledger. Crash-safety (no
 *  undefined derefs downstream) is what storage guarantees. */
export declare function isWellFormedImage(entry: unknown): entry is TaskImage;
/** Whether a raw value is a storable file ref (non-empty receipt + name;
 *  bytes only needs to be a number for display math — NaN displays ugly but
 *  never crashes and never deletes). Same leniency law as images above. */
export declare function isWellFormedFile(entry: unknown): entry is TaskFile;
/** Keep well-formed prompt images (a dirty element washes out, never the
 *  row and never a downstream crash). */
export declare function normalizePromptImages(raw: unknown): TaskImage[] | undefined;
/** Keep well-formed file refs (same law as images). */
export declare function normalizePromptFiles(raw: unknown): TaskFile[] | undefined;
/** Create a task from user input. */
export declare function createTask(input: NewTaskInput, now: number, id: string, order?: number): TaskRecord;
/** Clone a task with an updated status and a fresh updatedAt. A real column
 *  move appends to the status history (cycle/streak/throughput derivations
 *  read it — without it every duration is a guess); a same-status touch only
 *  refreshes updatedAt. A legacy row moving for the first time backfills its
 *  birth column from createdAt (the honest birth instant, same as the read
 *  path — one birth rule, never two). */
export declare function withStatus(task: TaskRecord, status: TaskStatus, now: number): TaskRecord;
/**
 * Merge a schedule patch into a task's schedule rule (creating it when
 * absent), with a fresh updatedAt. Keys present in the patch overwrite the
 * current value — including explicit `undefined`, which clears a field (used
 * to disarm `nextRunAt`); absent keys keep their current value.
 */
export declare function withSchedule(task: TaskRecord, patch: Partial<ScheduleRule>, now: number): TaskRecord;
/**
 * Open a fresh execution on a task: move it to 'running' and append a
 * running execution record. Returns the new task and the new execution.
 */
export declare function startExecution(task: TaskRecord, now: number, executionId: string): {
    task: TaskRecord;
    execution: ExecutionRecord;
};
/** Paused-readiness explanation keyed by the pausing status. */
/**
 * Create an externally-observed round (see `ExecutionRecord.external`): the
 * board detected native-side activity on a related session (out-of-band
 * chat). It enters the session's comment thread and drives the task state
 * like a running round, but is never queued/injected — it is already
 * happening. `refine: true` marks a refinement-session round, which keeps
 * the task in its column.
 */
export declare function newExternalRound(options: {
    id: string;
    now: number;
    sessionId: string;
    /** The native user message text observed at creation (the thread body). */
    text?: string;
    refine?: boolean;
    /** The native seq of the message that started this turn (dedup anchor). */
    anchor?: number;
    /** The observed message carried only image blocks (thread placeholder). */
    imageOnly?: boolean;
}): ExecutionRecord;
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
export declare function isBlankMessage(text: string, images?: readonly unknown[] | undefined, files?: readonly unknown[] | undefined): boolean;
/**
 * Create a new comment-continuation round (pure): the single factory for
 * both comment anchors. An execution-anchored comment (`parentExecutionId`)
 * continues a settled run and reuses its session; a session-anchored
 * comment (`sessionAnchor`) continues a linked session and reuses that
 * session. Either way the round carries the session id it will be injected
 * into, so the dispatcher's eligibility scan and the injection hand-off work
 * unchanged — one queue, one model, two surfaces.
 */
export declare function newCommentRound(options: {
    id: string;
    now: number;
    /** The trimmed comment text. */
    text: string;
    /** Whether the line is a slash command rather than a turn. */
    command?: boolean;
    /** The session the comment will be injected into (reused, never created). */
    sessionId: string;
    /** The settled execution this comment continues (execution-anchored). */
    parentExecutionId?: string;
    /** The linked session this comment continues (session-anchored). */
    sessionAnchor?: string;
    /** The session automation rule that created this round (loop marker). */
    ruleId?: string;
    /** Images carried by the comment (queued sends deliver them with the text). */
    images?: readonly TaskImage[];
    /** File refs carried by the comment (queued sends deliver them with the text). */
    files?: readonly TaskFile[];
}): ExecutionRecord;
/**
 * Create a direct-send round (直发模式): the message was already delivered to
 * the native session, so the round is settled-succeeded at birth — it exists
 * to make the line visible in the session's comment thread (next to drive
 * comments and execution comments), never to queue or drive anything.
 */
export declare function newDirectRound(options: {
    id: string;
    now: number;
    /** The trimmed message text that was sent. */
    text: string;
    /** The native session the message was sent to. */
    sessionId: string;
}): ExecutionRecord;
/**
 * Whether the card already holds completed work awaiting the human gate:
 * any settled non-refine round with a succeeded/failed outcome (plain runs,
 * comment continuations, externally-observed turns, direct sends — all are
 * completions the user has not confirmed). Cancelled rounds never count:
 * they are noise/abort, not work. Refine rounds never count: preparation
 * keeps its column by contract (`settleRefine`).
 * Used ONLY to decide where a `cancelled` settle lands (review vs todo) —
 * success/failure always land in review (or stay running for incomplete
 * batches/chains or sibling lanes).
 */
export declare function hasCompletedWork(task: TaskRecord): boolean;
/**
 * THE one column decision for every non-refine settle (success/failure/
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
export declare function settleColumnOf(task: TaskRecord, outcome: 'succeeded' | 'failed' | 'cancelled', othersOpen: boolean, chainIncomplete: boolean, batchIncomplete: boolean, stillWorking?: boolean): TaskStatus;
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
export declare function settleExecution(task: TaskRecord, executionId: string, outcome: 'succeeded' | 'failed' | 'cancelled', now: number, error: string | undefined, stillWorking?: boolean): TaskRecord;
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
 * - a refinement round: in flight while open (its session is working);
 * - an EXTERNAL round (a native turn the board observed): in flight while
 *   open — it is already happening, it is never queued or injected, and its
 *   `comment` is only the thread body;
 * - a comment round: in flight only ONCE INJECTED. A saved comment is queued
 *   — it must never show a spinner, block a rerun, hold a slot or mark its
 *   session busy.
 */
export declare function isOpenRound(round: ExecutionRecord): boolean;
/** Every in-flight round of a task, in submission order. THE truth the
 *  dispatcher, the budget and the column state machine all read — a card may
 *  legitimately run several sessions at once (one lane per session), so
 *  "the task's latest execution" is no longer the only thing that can be
 *  running. */
export declare function openRoundsOf(task: TaskRecord): ExecutionRecord[];
/**
 * Every in-flight EXECUTION round (refinement excluded). Refinement is
 * preparation inside its own column — it holds a budget slot while working
 * but must never hold the card in 进行中 nor block a plain settle from
 * landing in 待审核 (the display truth `executing` already excludes it;
 * the column gate follows the same law here).
 */
export declare function openExecutionRoundsOf(task: TaskRecord): ExecutionRecord[];
/** Whether a given session of the task is busy (an in-flight round anchored
 *  to it). A comment may only inject into a session that is idle, and a
 *  session's own comments always go in order — the lane is the session. */
export declare function sessionIsBusy(task: TaskRecord, sessionId: string): boolean;
/**
 * Whether the task is genuinely executing right now: ANY of its rounds is in
 * flight. A pending comment round (saved while the cruise is off, the task
 * not running) is NOT an open run — it must never show a spinner on the card,
 * block a rerun, or block a drag. An open requirement-refinement round IS:
 * the task's session is working, so a plain run must not start on top of it.
 * One shared judgment for the card, the drop rules and the run guard.
 */
export declare function hasOpenRun(task: TaskRecord): boolean;
/**
 * How many comment rounds of a task are saved but not yet injected (the
 * task's comment queue). These wait for the dispatcher — the budget, the
 * cruise toggle, or the task's own busy round — and can be cancelled.
 */
export declare function pendingCommentCount(task: TaskRecord): number;
/**
 * The task's plain runs in chronological order — every execution record
 * except comment and refine rounds. The single numbering source for the
 * execution history list (TaskDetail) and the review page header ("第 N 次
 * 执行"): continuations and refinements are not part of the run sequence.
 */
export declare function plainRunsOf(task: TaskRecord): readonly ExecutionRecord[];
/**
 * The task's requirement-refinement rounds in chronological order (the
 * conversation turns of the task's bound refine session).
 */
export declare function refineRoundsOf(task: TaskRecord): readonly ExecutionRecord[];
/** Whether a requirement-refinement round is currently running for the task. */
export declare function refining(task: TaskRecord): boolean;
/**
 * Whether the task has anything to refine: title, description or execution
 * prompt — at least one must be non-blank, because the refine instruction is
 * built from exactly these three fields. An all-blank task would send an
 * empty requirement round (a wasted run that only flips the card's lights);
 * the UI disables the entry and says so instead of launching it.
 */
export declare function refinable(task: TaskRecord): boolean;
/**
 * Whether the task is genuinely EXECUTING right now (display truth): an open
 * plain run, external round or injected comment — but NOT a lone refinement
 * round. Refining is preparation inside the backlog column (its own 完善中
 * chip + breathing); reading it as 进行中 is the "一点完善整卡变进行中" bug.
 * Blocking semantics (run guard, concurrency budget, drop rules, reconcile
 * drive) stay on {@link hasOpenRun} — this is display only, never a gate.
 */
export declare function executing(task: TaskRecord): boolean;
/** Bind (or re-bind) the task's requirement-refinement session. */
export declare function withRefineSession(task: TaskRecord, sessionId: string, now: number): TaskRecord;
/**
 * Settle a requirement-refinement round: record the outcome on the round
 * without moving the task out of its column (refinement is preparation, not
 * execution — the card stays exactly where it is). No-op when the round is
 * unknown or already settled.
 */
export declare function settleRefine(task: TaskRecord, executionId: string, outcome: 'succeeded' | 'failed' | 'cancelled', now: number, error: string | undefined): TaskRecord;
/** What a card drop onto a column means (drag-and-drop decision). */
export type CardDropDecision = {
    kind: 'none';
} | {
    kind: 'move';
    status: TaskStatus;
} | {
    kind: 'run';
} | {
    kind: 'reject';
    reason: 'busy';
};
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
export declare function resolveCardDrop(task: TaskRecord, target: TaskStatus): CardDropDecision;
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
 * law promoteToColumnTop already follows.
 */
export declare function applyCardOrder(tasks: readonly TaskRecord[], movedId: string, targetStatus: TaskStatus, beforeId: string | undefined, now: number): TaskRecord[];
/**
 * Promote a card to the TOP of its column — the "newest state first" rule:
 * a task that just entered a column (freshly created, newly bound from the
 * workspace, or passing through a status change) reads as the newest item
 * of that column. Existing cards shift down, preserving their relative
 * order; a manual reorder later overrides the promotion. Only the target
 * column's orders are rewritten.
 */
export declare function promoteToColumnTop(tasks: readonly TaskRecord[], movedId: string, targetStatus: TaskStatus, now: number): TaskRecord[];
