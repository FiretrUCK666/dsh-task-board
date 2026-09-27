/**
 * The action catalog — ONE registry, read by four surfaces.
 *
 * A board exposes ~90 public methods but only a dozen real verbs, so the tool
 * surface converges on the verbs instead of the method count. The catalog is
 * the single source those four views are rendered from: the tool schema, the
 * capability query, the system-prompt rule set, and the coverage check that
 * fails the build when the UI grows an action nobody told the model about.
 * Four views of one table cannot drift; four hand-written tables always do.
 *
 * WHAT IS AND IS NOT AN ACTION. Actions change data. Read projections
 * (`liveStateOf`, `getSnapshot`, …) and view switches are NOT actions — except
 * that the view switches are still LISTED here, marked `surface: 'ui'`, because
 * the coverage check compares this table against every method the UI calls: a
 * UI-only method missing from the catalog reads as "the UI grew something the
 * model was never told about", which is exactly the drift this file exists to
 * make impossible. Listing them is what makes "the model cannot do this" a
 * deliberate, visible fact rather than an omission.
 *
 * THREE RULES, each one a decision this codebase already made:
 *
 *  1. WHAT THE UI LOCKS DOWN, THE TOOL LOCKS DOWN. A model that can do what a
 *     person cannot turns the interface's promise into a lie (a dropdown that
 *     says "pick one" is a promise; an agent that can retarget it is a bug with
 *     a good PR). So a locked control is ABSENT from `params` — not documented
 *     as forbidden, absent — and the action's `summary` says so out loud, so
 *     the model never spends a turn discovering it. See `rule.update`.
 *  2. `surface: 'ui'` NEVER REACHES THE TOOL. Navigation and view switches are
 *     listed (rule above) and excluded from the op enum by
 *     {@link TOOL_ACTION_IDS}, which is the only place that exclusion is
 *     decided. "Open this card" means nothing in another context.
 *  3. EVERY PARAMETER STATES ITS CONDITION. A model that omits a required
 *     parameter or passes an inapplicable one is the most common way a batch
 *     half-succeeds. Each {@link ParamSpec} therefore says whether it may be
 *     omitted, and under what condition it becomes required or stops applying
 *     — the cheapest mitigation there is, and the one that turns a silent
 *     wrong answer into an obvious one.
 *
 * The `semantic` flag is the anti-drift mark for actions with real meaning (a
 * column move that must also disarm automation): it names the shared core pure
 * function that BOTH the UI and the tool must call, so "the same thing, two
 * results" cannot ship. The named functions land with the transitions module;
 * until one exists, no action claims `semantic` — a catalog is a contract, not
 * a promise, and `actionCatalogFindings` is what keeps the two honest.
 */
import { MANUAL_STATUSES } from './tasks.ts'
import type { TaskUpdatePatch } from './controller.ts'
import { ITEM_FIELDS, ITEM_PRIORITIES, ITEM_STATUSES, type FieldSpec } from './item.ts'

// The field-verdict vocabulary belongs to the models (item.ts), not here: this
// catalog only rules on the task patch. Re-exported so both verdicts read from
// one import site.
export type { FieldSpec }

/** The twelve verbs. The table is a CONTRACT: a thirteenth verb is a decision,
 *  not a convenience, and the catalog is written to fit inside these. */
export type BoardVerb =
  | 'create'    // 建
  | 'update'    // 改字段
  | 'move'      // 移栏
  | 'delete'    // 删
  | 'run'       // 跑
  | 'speak'     // 说话（对某个会话发一条）
  | 'bind'      // 绑会话
  | 'automate'  // 自动化规则（排期 / 会话规则 / 巡航）
  | 'cruise'    // 巡航
  | 'ack'       // 已读钟
  | 'navigate'  // 导航（开哪张卡、哪个会话、回看板）
  | 'query'     // 查

/** Which document a section of the surface speaks about. */
export type ActionDomain = 'board' | 'item' | 'preset' | 'session'

/**
 * How the effect travels. `document` writes the document (a Commit through the
 * merge grammar — the only lane that converges across devices). `engine`
 * needs the live host: a run, a session, a rename of a native session. The
 * distinction is not a style choice — a document write made while the engine is
 * offline is a fact on every device, while an engine write is a request that
 * may still be queued.
 */
export type ActionLane = 'document' | 'engine'

/**
 * What it costs to be wrong. `reversible` — undoing it is an ordinary action.
 * `guarded` — it is refused unless a stated condition holds, or it can only be
 * taken back by hand. `irreversible` — nothing brings it back.
 */
export type ActionDanger = 'reversible' | 'guarded' | 'irreversible'

/**
 * Who can reach it. `ui` — the model cannot (rule 2 above). `ui+ai` — both.
 * `ai-only` — the model only; there is no interface for it, which is a real
 * state of the world (an agent-originated row is the example) and must be
 * declared, never implied by absence.
 */
export type ActionSurface = 'ui' | 'ui+ai' | 'ai-only'

/**
 * One parameter of one action.
 *
 * The three states are exhaustive and mutually exclusive, and they are stated
 * per parameter so a schema renderer can print the right sentence:
 * - `optional: true` — may always be omitted. Absent means "leave it alone",
 *   NEVER "clear it": a patch that cannot express "empty this" must not look
 *   like it can.
 * - `requiredWhen` — may be omitted UNLESS the stated condition holds.
 * - neither — always required.
 */
export interface ParamSpec {
  /** One line, written for whoever has to fill it in (usually a model). */
  readonly about: string
  /** A closed set, when there is one. Keeps a renderer from inventing values. */
  readonly oneOf?: readonly string[]
  readonly optional?: true
  /** Required only under this condition — stated, never left to be inferred. */
  readonly requiredWhen?: string
  /** Meaningless unless this holds — so a model does not invent it. */
  readonly appliesWhen?: string
}

/**
 * Per-action parameter TYPING, keyed by action id. Deliberately empty: writing
 * parameter types before anyone has agreed on them would be a contract nobody
 * read, and an invented type is harder to remove than a missing one. The tool
 * schema knife adds entries here; until then every action's `params` is the
 * widened description table, and this interface is the seam it narrows.
 */
export interface ActionParamTypes {}

/** The parameter table of one action: the per-action typing where it exists,
 *  the widened description table everywhere else. */
export type ActionParams<K extends ActionId> =
  K extends keyof ActionParamTypes ? ActionParamTypes[K] : Readonly<Record<string, ParamSpec>>

/**
 * What an action IS — every field except the per-action typing of `params`.
 * Split out because the catalog table must be checkable against a type that
 * does not mention {@link ActionId}: the id union IS derived from that table,
 * so a shape depending on it would be circular (and a circular `satisfies`
 * silently degrades the table to `any` instead of failing where you meant).
 */
export interface ActionShape {
  /** One of the twelve. */
  readonly verb: BoardVerb
  readonly domain: ActionDomain
  readonly lane: ActionLane
  readonly danger: ActionDanger
  /** One sentence, for the model: what this action DOES (not how to spell it). */
  readonly summary: string
  readonly params: Readonly<Record<string, ParamSpec>>
  readonly surface: ActionSurface
  /** Set when the action has meaning beyond its field writes, so the UI and the
   *  tool must share one implementation. Then `semanticOf` is required. */
  readonly semantic?: true
  /** The shared core pure function this action must go through. */
  readonly semanticOf?: string
}

/** What an action IS. Never how it is carried out — that is the lane's job. */
export interface ActionSpec<K extends ActionId> extends ActionShape {
  readonly params: ActionParams<K>
}

/** The columns a person may drag a card to by hand — the runner owns the rest. */
const MOVABLE: readonly string[] = MANUAL_STATUSES

/**
 * Every field the task patch may carry, ruled on. The key set is
 * `keyof TaskUpdatePatch`, so a field added to the patch without a verdict here
 * fails the build — the same law as {@link ITEM_FIELDS}, on the task side.
 */
export const TASK_FIELDS: Record<keyof TaskUpdatePatch, FieldSpec> = {
  title: { access: 'writable', why: '一行标题，可以留空（空了就从执行 Prompt 补）' },
  description: { access: 'writable', why: '详情正文，参与展示' },
  prompt: { access: 'writable', why: '执行 Prompt，卡真正跑起来送出去的那段' },
  promptImages: {
    access: 'forbidden',
    why: '图片要走浏览器压缩 + 上传通道，模型手里没有；凭空的图片引用等于一张画不出来的卡',
  },
  promptFiles: {
    access: 'forbidden',
    why: '文件引用必须是真实上传换来的 receiptId，模型编一个就是一条断链',
  },
  workspaceId: { access: 'writable', why: '跑在哪台机器上，参与运行配置' },
  provider: { access: 'writable', why: '模型供应方' },
  model: { access: 'writable', why: '模型' },
  reasoningEffort: { access: 'writable', why: '思考档位' },
  agentPreset: { access: 'writable', why: '代理预设，决定这条会话由谁扮演' },
  permission: { access: 'writable', why: '权限预设；只能填目录里真实存在的键，不存在就照原样留着' },
  color: { access: 'writable', why: '卡片强调色（数据，不是样式）' },
}

/** The checklist's own enums, restated for a schema renderer that must not
 *  import the model module to print a value list. */
const ITEM_STATUS_VALUES: readonly string[] = ITEM_STATUSES
const ITEM_PRIORITY_VALUES: readonly string[] = ITEM_PRIORITIES

/**
 * THE CATALOG. Keyed by action id; the id set is the closed `ActionId` union,
 * so an action that exists but was never described here cannot be referenced,
 * and a description without an implementation is a visible hole rather than a
 * silent one.
 *
 * Ids read `<subject>.<verb>`. The subject is the thing acted on (`task`,
 * `item`, `board`, `cruise`, `rule`, `session`, `preset`); the verb is one of
 * the twelve. `domain` says which document the action speaks about, which is
 * not always the subject: a rule belongs to the session domain, a cruise
 * switch to the board's.
 */
export const ACTIONS = {
  // --- board: cards -------------------------------------------------------------
  'task.create': {
    verb: 'create',
    domain: 'board',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    summary: '建一张新卡。执行 Prompt 是它能跑起来的唯一原因，所以必填。',
    params: {
      prompt: { about: '执行 Prompt：这条卡跑起来时真正送出去的那段话' },
      title: { about: '一行标题', optional: true, appliesWhen: '留空时由执行 Prompt 补，不会覆盖已填的标题' },
      description: { about: '详情正文', optional: true },
      status: { about: '落哪一栏', optional: true, oneOf: MOVABLE, appliesWhen: '只能落在人手能拖过去的栏；「进行中」「待审核」归执行器' },
      beforeId: { about: '插到这张卡前面', optional: true, appliesWhen: '只在同一栏内排序时需要' },
      bind: { about: '建卡时直接挂上的会话或工作区（可多项）', optional: true },
    },
  },
  'task.duplicate': {
    verb: 'create',
    domain: 'board',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    summary: '照着一张已有的卡复制一张新的（新的 id、新的编号，排期与规则不上膛）。',
    params: {
      of: { about: '被复制的卡' },
    },
  },
  'task.update': {
    verb: 'update',
    domain: 'board',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    summary: '改一张卡的字段。只改传了的字段；图片与文件不可写（没有上传通道，凭引用只会画出空白）。',
    params: {
      of: { about: '要改的卡' },
      title: { about: '一行标题', optional: true },
      description: { about: '详情正文', optional: true },
      prompt: { about: '执行 Prompt', optional: true },
      workspaceId: { about: '跑在哪台机器上', optional: true },
      provider: { about: '模型供应方', optional: true },
      model: { about: '模型', optional: true },
      reasoningEffort: { about: '思考档位', optional: true },
      agentPreset: { about: '代理预设', optional: true },
      permission: { about: '权限预设，只能填目录里存在的键', optional: true },
      color: { about: '卡片强调色', optional: true },
    },
  },
  'task.move': {
    verb: 'move',
    domain: 'board',
    lane: 'document',
    danger: 'guarded',
    surface: 'ui+ai',
    summary: '把卡移到另一栏。移到「已完成」会同时解甲排期与全部会话规则；这一栏真有轮次在跑时移动被拒。',
    params: {
      of: { about: '要移动的卡' },
      status: { about: '目标栏', oneOf: MOVABLE },
      beforeId: { about: '插到同栏这张卡之前', optional: true, appliesWhen: '只在同一栏内排序时需要' },
    },
  },
  'task.approve': {
    verb: 'move',
    domain: 'board',
    lane: 'document',
    danger: 'guarded',
    surface: 'ui+ai',
    summary: '通过一张待审核的卡：标已读并移到「已完成」。有轮次在跑时拒绝，状态原样不动。',
    params: {
      of: { about: '要通过的卡' },
    },
  },
  'task.delete': {
    verb: 'delete',
    domain: 'board',
    lane: 'document',
    danger: 'irreversible',
    surface: 'ui+ai',
    summary: '删一张卡。不可恢复（清单条目的删除走墓碑能找回，卡片不行），做之前先给用户看清单。',
    params: {
      of: { about: '要删的卡' },
    },
  },
  'task.schedule': {
    verb: 'automate',
    domain: 'board',
    lane: 'document',
    danger: 'guarded',
    surface: 'ui+ai',
    summary: '给卡上/解排期。给没有执行 Prompt 的卡上膛会被拒（规则永远跑不起来，开关却显示已开）。',
    params: {
      of: { about: '要排期的卡' },
      enabled: { about: '上膛还是解甲', optional: true },
      mode: { about: 'cron 定时 / chain 完成后接续', optional: true, oneOf: ['cron', 'chain'] },
      cron: { about: '五段 cron 表达式', requiredWhen: 'mode 是 cron（上膛时必填；解甲不必给）' },
      maxRuns: { about: '最多跑几次', optional: true, appliesWhen: '留空 = 不限次' },
    },
  },
  'task.run': {
    verb: 'run',
    domain: 'board',
    lane: 'engine',
    danger: 'guarded',
    surface: 'ui+ai',
    summary: '立刻跑一次这张卡。会真开会话、真花 token；没有浏览器持席位时只能排队，引擎上线才补发。',
    params: {
      of: { about: '要跑的卡' },
      trigger: { about: '触发来源（只影响归因，不影响执行）', optional: true, oneOf: ['manual', 'schedule', 'chain'] },
    },
  },
  'task.comment': {
    verb: 'speak',
    domain: 'board',
    lane: 'engine',
    danger: 'guarded',
    surface: 'ui+ai',
    summary: '对这张卡的某个会话发一条消息，接着上次的对话继续。排队还是插话由用户的开关定，不接受指定。',
    params: {
      of: { about: '目标卡' },
      session: { about: '目标会话', requiredWhen: '这张卡挂了不止一个会话时必须指明' },
      text: { about: '要发的话' },
      command: { about: '这是一条斜杠命令而不是一句话', optional: true, oneOf: ['true', 'false'] },
    },
  },
  'task.cancelComment': {
    verb: 'delete',
    domain: 'board',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    summary: '撤掉一条还在排队的评论轮次（已经注入出去的那条撤不回来）。',
    params: {
      round: { about: '要撤的轮次' },
    },
  },
  'task.ack': {
    verb: 'ack',
    domain: 'board',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui',
    summary: '已读钟。属于人：模型替人标已读会直接消掉「待你决断」那道门，所以工具不提供它。',
    params: {
      of: { about: '要标已读的卡', requiredWhen: 'scope 不是 all' },
      scope: { about: '标到哪一层', optional: true, oneOf: ['task', 'session', 'round'] },
      session: { about: '会话轮', requiredWhen: 'scope 是 session' },
      round: { about: '轮次', requiredWhen: 'scope 是 round' },
    },
  },
  'task.navigate': {
    verb: 'navigate',
    domain: 'board',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui',
    summary: '打开一张卡的详情。',
    params: {
      of: { about: '要打开的卡' },
    },
  },
  'board.cruise': {
    verb: 'cruise',
    domain: 'board',
    lane: 'document',
    danger: 'guarded',
    surface: 'ui+ai',
    summary: '巡航总开关与并发上限。巡航关着时排队的评论不会注入——这时发消息等于什么都没发生，所以如实说清。',
    params: {
      enabled: { about: '开还是关', optional: true },
      limit: { about: '同时跑几条（1..20）', optional: true },
    },
  },
  'board.navigate': {
    verb: 'navigate',
    domain: 'board',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui',
    summary: '在看板与会话之间切换舞台。',
    params: {
      target: { about: '要去哪', optional: true, oneOf: ['board', 'conversation'] },
    },
  },

  // --- session rules (the automation that talks to a session) -------------------
  'rule.create': {
    verb: 'automate',
    domain: 'session',
    lane: 'document',
    danger: 'guarded',
    surface: 'ui+ai',
    summary: '给卡上的某个会话建一条自动化规则。一张卡对同一个会话只允许一条（要改就改它，不叠触发）。',
    params: {
      of: { about: '目标卡' },
      session: { about: '要被自动化的会话' },
      trigger: { about: 'cron 定时 / on-complete 每次跑完', optional: true, oneOf: ['cron', 'on-complete'] },
      cron: { about: '五段 cron 表达式', requiredWhen: 'trigger 是 cron' },
      usePrompt: { about: '送这张卡当前的执行 Prompt，而不是自定义文本', optional: true, oneOf: ['true', 'false'] },
      instruction: { about: '要定时送出去的话', requiredWhen: 'usePrompt 是 false' },
      send: { about: '排队还是插话', oneOf: ['queue', 'steer'] },
    },
  },
  'rule.update': {
    verb: 'automate',
    domain: 'session',
    lane: 'document',
    danger: 'guarded',
    surface: 'ui+ai',
    summary: '改一条已有规则的内容、触发方式、发送方式或开关。目标会话不可改：界面上这个下拉是锁死的，一个会话的自动化只有一条定义，工具不能偷偷换目标。',
    params: {
      of: { about: '目标卡' },
      rule: { about: '要改的规则' },
      enabled: { about: '上膛还是解甲', optional: true },
      trigger: { about: 'cron 定时 / on-complete 每次跑完', optional: true, oneOf: ['cron', 'on-complete'] },
      cron: { about: '五段 cron 表达式', requiredWhen: 'trigger 是 cron' },
      usePrompt: { about: '送执行 Prompt 而不是自定义文本', optional: true, oneOf: ['true', 'false'] },
      instruction: { about: '要定时送出去的话', requiredWhen: 'usePrompt 是 false' },
      send: { about: '排队还是插话', optional: true, oneOf: ['queue', 'steer'] },
    },
  },
  'rule.delete': {
    verb: 'delete',
    domain: 'session',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    summary: '删掉一条会话自动化规则。',
    params: {
      of: { about: '目标卡' },
      rule: { about: '要删的规则' },
    },
  },

  // --- the card's session list --------------------------------------------------
  'session.create': {
    verb: 'create',
    domain: 'session',
    lane: 'engine',
    danger: 'guarded',
    surface: 'ui+ai',
    summary: '按给定的运行配置建一条新的原生会话，并挂到这张卡上——这正是「开一个新 session 让它调用任务看板」要做的事。卡本身不动：不产生执行记录、不进派发队列、不碰任何自动化。会话是原生侧真实存在的东西，绑定可以摘掉，关掉它要用户自己在原生界面做。会话创建在宿主缺席时直接失败，不会假装排队。',
    params: {
      of: { about: '要挂到哪张卡上' },
      title: {
        about: '会话名',
        optional: true,
        appliesWhen: '留空 = 一个字都不发，会话由宿主自己的命名链在第一句真话之后命名；给了名字就用官方改名接口钉住它，宿主之后不会再自动改名',
      },
      workspaceId: { about: '跑在哪台机器上', optional: true, appliesWhen: '留空 = 不指定，由宿主按自己的默认链解析' },
      provider: { about: '模型供应方', optional: true, appliesWhen: '留空 = 不指定，由宿主按自己的默认链解析' },
      model: { about: '模型', optional: true, appliesWhen: '留空 = 不指定，由宿主按自己的默认链解析' },
      reasoningEffort: { about: '思考档位', optional: true, appliesWhen: '留空 = 不指定，由宿主按自己的默认链解析' },
      agentPreset: { about: '代理预设', optional: true, appliesWhen: '留空 = 不指定，由宿主按自己的默认链解析' },
      permission: { about: '权限预设，只能填目录里真实存在的键', optional: true, appliesWhen: '留空 = 不指定，由宿主按自己的默认链解析' },
    },
  },
  'session.bind': {
    verb: 'bind',
    domain: 'session',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    summary: '给卡挂一个来源：一个会话，或一个整个工作区。一次加一个。',
    params: {
      of: { about: '目标卡' },
      session: { about: '要挂的会话', requiredWhen: '没给 workspace 时必填' },
      workspace: { about: '要挂的工作区', requiredWhen: '没给 session 时必填' },
    },
  },
  'session.remove': {
    verb: 'delete',
    domain: 'session',
    lane: 'document',
    danger: 'guarded',
    surface: 'ui+ai',
    summary: '把一个会话从卡上永久摘掉（连它的轮次一起）。这是删除，不是隐藏。',
    params: {
      of: { about: '目标卡' },
      session: { about: '要摘掉的会话' },
    },
  },
  'session.rename': {
    verb: 'update',
    domain: 'session',
    lane: 'engine',
    danger: 'guarded',
    surface: 'ui+ai',
    summary: '给这个会话改个显示用的名字。',
    params: {
      of: { about: '目标卡' },
      session: { about: '要改名的会话' },
      title: { about: '新名字' },
    },
  },
  'session.reorder': {
    verb: 'update',
    domain: 'session',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    summary: '调整卡上会话列表的顺序。',
    params: {
      of: { about: '目标卡' },
      session: { about: '要移动的会话' },
      beforeId: { about: '插到这个会话前面', optional: true, appliesWhen: '只在列表内排序时需要' },
    },
  },
  'session.hide': {
    verb: 'update',
    domain: 'session',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui',
    summary: '把某几行收进隐藏格（可一键恢复，不是删除）。纯显示选择，工具不代劳。',
    params: {
      of: { about: '目标卡' },
      session: { about: '要收起的会话', requiredWhen: '动的是会话行' },
      round: { about: '要收起的轮次', requiredWhen: '动的是轮次行' },
      hidden: { about: '收起还是恢复', oneOf: ['true', 'false'] },
    },
  },
  'session.navigate': {
    verb: 'navigate',
    domain: 'session',
    lane: 'engine',
    danger: 'reversible',
    surface: 'ui',
    summary: '打开一个会话。',
    params: {
      session: { about: '要打开的会话' },
    },
  },

  // --- presets (the board's two synced sections) ---------------------------------
  'preset.create': {
    verb: 'create',
    domain: 'preset',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    summary: '存一条自己的预设：一条排期预设（名字 + cron）或一条运行配置预设（名字 + 若干运行字段）。',
    params: {
      kind: { about: '哪一种预设', oneOf: ['schedule', 'run'] },
      label: { about: '预设名' },
      cron: { about: '五段 cron 表达式', requiredWhen: 'kind 是 schedule' },
      config: { about: '运行配置（模型 / 思考档 / 权限预设…）', requiredWhen: 'kind 是 run' },
    },
  },
  'preset.update': {
    verb: 'update',
    domain: 'preset',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    summary: '改一条自己的预设，或把它设成默认（只有运行配置预设有默认这回事）。',
    params: {
      of: { about: '要改的预设' },
      label: { about: '新名字', optional: true },
      cron: { about: '新的五段 cron 表达式', optional: true, appliesWhen: '只对排期预设' },
      config: { about: '新的运行配置', optional: true, appliesWhen: '只对运行配置预设' },
      makeDefault: { about: '设为默认 / 取消默认', optional: true, oneOf: ['true', 'false'], appliesWhen: '只对运行配置预设' },
    },
  },
  'preset.delete': {
    verb: 'delete',
    domain: 'preset',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    summary: '删掉一条自己的预设（内置的那批删不掉，也不用删）。',
    params: {
      of: { about: '要删的预设' },
    },
  },

  // --- the checklist ------------------------------------------------------------
  'item.create': {
    verb: 'create',
    domain: 'item',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    summary: '记一条清单条目。标题可以留空（会从正文首行补），步骤只有一层、进度自动算。',
    params: {
      body: { about: '正文，Markdown' },
      title: { about: '一行标题', optional: true },
      notes: { about: '给接手的人或模型看的上下文备注', optional: true },
      steps: { about: '勾选清单（只有一层）', optional: true },
      status: { about: '开放 / 受阻 / 完成', optional: true, oneOf: ITEM_STATUS_VALUES },
      priority: { about: '四档优先级', optional: true, oneOf: ITEM_PRIORITY_VALUES },
      tags: { about: '自由标签', optional: true },
      startsAfter: { about: '最早开始（毫秒时间戳）', optional: true },
      dueAt: { about: '截止（毫秒时间戳）', optional: true },
      hardDueAt: { about: '硬期限（毫秒时间戳）', optional: true },
      taskId: { about: '关联的看板卡片（零张或一张）', optional: true },
    },
  },
  'item.update': {
    verb: 'update',
    domain: 'item',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    summary: '改一条清单条目（用 #编号 指它）。只改传了的字段；编号与来源不可写。',
    params: {
      of: { about: '要改的条目编号（#12 那个号）' },
      title: { about: '一行标题', optional: true },
      body: { about: '正文，Markdown', optional: true },
      notes: { about: '上下文备注', optional: true },
      steps: { about: '勾选清单（整份替换，只有一层）', optional: true },
      status: { about: '开放 / 受阻 / 完成（「进行中」是派生的，不可写）', optional: true, oneOf: ITEM_STATUS_VALUES },
      priority: { about: '四档优先级', optional: true, oneOf: ITEM_PRIORITY_VALUES },
      tags: { about: '自由标签（整份替换）', optional: true },
      startsAfter: { about: '最早开始', optional: true },
      dueAt: { about: '截止', optional: true },
      hardDueAt: { about: '硬期限', optional: true },
      taskId: { about: '关联的看板卡片', optional: true },
    },
  },
  'item.delete': {
    verb: 'delete',
    domain: 'item',
    lane: 'document',
    danger: 'guarded',
    surface: 'ui+ai',
    summary: '删一条清单条目。走墓碑，所以能恢复；但没有撤销层，删之前值得先说一句。',
    params: {
      of: { about: '要删的条目编号' },
    },
  },
} as const satisfies Record<string, ActionShape>

/** Every action the catalog declares. The closed union every other type keys on. */
export type ActionId = keyof typeof ACTIONS

/** The verbs, as data — the coverage gate and any renderer read this, never a
 *  second hand-written list. `query` is the read lane's verb and has no action
 *  here on purpose: a query is not a change, and its shape comes from the
 *  qualifier registry, not from a row in this table. */
export const BOARD_VERBS: readonly BoardVerb[] = [
  'create', 'update', 'move', 'delete', 'run', 'speak', 'bind', 'automate', 'cruise', 'ack', 'navigate', 'query',
]

/**
 * The ops the TOOL may offer: everything the model can reach. This is the one
 * place rule 2 is decided, so nothing has to remember it (a second list would
 * be the drift this file exists to prevent).
 */
export const TOOL_ACTION_IDS: readonly ActionId[] = (
  Object.keys(ACTIONS) as ActionId[]
).filter(id => ACTIONS[id].surface !== 'ui')

/**
 * The envelope around a batch of ops — NOT per-action parameters, because it
 * describes the call and not the action. `dry_run` is always optional and is
 * the same for every op: a whole batch rehearsed on a clone, not one op at a
 * time (an op at a time would be a second undo stack, and the merge grammar
 * has no room for one).
 */
export const EXECUTE_ENVELOPE_PARAMS: Readonly<Record<string, ParamSpec>> = {
  dry_run: { about: '只演练不落盘：整批在文档克隆上跑，返回会改什么', optional: true },
  idempotencyKey: { about: '幂等键：同一个键重试不会重复执行、不会重复烧钱', optional: true },
}

/** The inputs a catalog check runs against. All optional: with none supplied
 *  it checks the real catalog against the real verdicts. */
export interface CatalogChecks {
  /** The action table to check. */
  readonly actions?: Readonly<Record<string, ActionShape>>
  /** The shared pure functions that actually exist, keyed by name. A `semantic`
   *  action naming anything outside it is a finding. */
  readonly semantic?: Readonly<Record<string, true>>
  /** The task patch's field verdicts. */
  readonly taskFields?: Readonly<Record<string, FieldSpec>>
  /** The checklist row's field verdicts. */
  readonly itemFields?: Readonly<Record<string, FieldSpec>>
}

/**
 * What the catalog itself guarantees. Mechanical, so it costs nothing to keep
 * honest: the coverage gate runs this over the real table, and the tests run it
 * over deliberately broken copies to prove it is not a rubber stamp.
 *
 * The load-bearing check is the one that ties the two halves of this file
 * together: a parameter whose name is a model field must be WRITABLE in that
 * model's verdict table. That is what stops the tool from offering a field the
 * model ruled forbidden — the `forbidden` verdicts (`promptImages`,
 * `promptFiles`, an item's `ref`/`origin`) are declarations, and without this
 * check nothing would stop a renderer from handing them to a model anyway.
 */
export function actionCatalogFindings(checks: CatalogChecks = {}): string[] {
  const table: Readonly<Record<string, ActionShape>> = checks.actions ?? ACTIONS
  const semantic = checks.semantic ?? {}
  const verdictsByDomain: Partial<Record<ActionDomain, Readonly<Record<string, FieldSpec>>>> = {
    board: checks.taskFields ?? TASK_FIELDS,
    item: checks.itemFields ?? ITEM_FIELDS,
  }
  const findings: string[] = []
  for (const [id, spec] of Object.entries(table)) {
    if (!BOARD_VERBS.includes(spec.verb)) findings.push(`${id}: verb "${spec.verb}" is not one of the twelve`)
    if (spec.summary.trim() === '') findings.push(`${id}: has no summary — a schema renderer would print a nameless op`)
    if (spec.semantic === true) {
      if (spec.semanticOf === undefined || spec.semanticOf === '') {
        findings.push(`${id}: marked semantic without naming the shared core function (semanticOf)`)
      } else if (!(spec.semanticOf in semantic)) {
        findings.push(`${id}: claims semanticOf "${spec.semanticOf}", which is not a shared core function that exists`)
      }
    } else if (spec.semanticOf !== undefined) {
      findings.push(`${id}: names semanticOf "${spec.semanticOf}" without being marked semantic`)
    }
    const verdicts = verdictsByDomain[spec.domain]
    for (const [param, p] of Object.entries(spec.params)) {
      if (p.about.trim() === '') findings.push(`${id}.${param}: has no description`)
      if (p.optional === true && p.requiredWhen !== undefined) {
        findings.push(`${id}.${param}: declared both optional and requiredWhen — pick one, or the schema prints both`)
      }
      if (p.requiredWhen !== undefined && p.requiredWhen.trim() === '') {
        findings.push(`${id}.${param}: requiredWhen is empty — say the condition or drop the field`)
      }
      if (p.appliesWhen !== undefined && p.appliesWhen.trim() === '') {
        findings.push(`${id}.${param}: appliesWhen is empty — say the condition or drop the field`)
      }
      // The load-bearing check: a parameter named after a model field may only
      // exist if that field is writable. A domain with no model of its own
      // (presets, session rules) has no verdict table and is skipped.
      const verdict = verdicts?.[param]
      if (verdict !== undefined && verdict.access !== 'writable') {
        findings.push(`${id}.${param}: offered as a parameter, but the model rules this field "${verdict.access}" — ${verdict.why}`)
      }
    }
  }
  return findings
}
