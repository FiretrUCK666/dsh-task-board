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
import * as taskTransitions from './task-transitions.ts'
import * as itemTransitions from './item-transitions.ts'
import * as itemAsk from './item-ask.ts'
import * as itemNavigate from './item-navigate.ts'
import { ITEM_FIELDS, ITEM_PRIORITIES, ITEM_STATUSES, type FieldSpec } from './item.ts'
import * as itemsDocument from './items-doc.ts'
import { ITEM_PAGES } from './item-view.ts'

// The field-verdict vocabulary belongs to the models (item.ts), not here: this
// catalog only rules on the task patch. Re-exported so both verdicts read from
// one import site.
export type { FieldSpec }

/** The thirteen verbs. The table is a CONTRACT: a fourteenth verb is a decision,
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
  | 'restore'   // 找回（删掉的条目；删除走墓碑，所以找得回）
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

  /**
   * THE VALUE SHAPES, FIVE OF THEM, DELIBERATELY NOT ONE.
   *
   * One "allowed values" field that could hold an enum, a boolean and a range
   * would be the exact shape that invites the mistake this table already made
   * once: declaring something stricter than the truth and handing a model a
   * confidently wrong answer. Each shape gets its own field so none can be read
   * as another — a boolean can no longer be spelled as two strings.
   */

  /** A closed set of STRING values. Never a boolean, never a number. */
  readonly oneOf?: readonly string[]
  /** The value is a boolean. Not `oneOf: ['true','false']` — that is a lie about
   *  the type, and the host would read the string as truthy or reject it. */
  readonly boolean?: true
  /** A closed numeric interval, inclusive on both ends. */
  readonly range?: { readonly min: number; readonly max: number }
  /** The value is an object with exactly these keys. A key the DOCUMENT owns is
   *  deliberately not among them, so the model is never asked to mint an id. */
  readonly object?: readonly string[]
  /** The value is a list: `'string'`, `'object'`, or a {@link ParamSpec}
   *  describing ONE element. Declaring the element is not optional politeness —
   *  an undeclared element shape is how a list of strings silently loses every
   *  row it is given. */
  readonly list?: 'string' | 'object' | ParamSpec

  /** What an ABSENT key means, in one sentence. Needed whenever the default is
   *  not the obvious one — a parameter whose "not given" case means something
   *  surprising (here: switching something OFF) must say so, or the reader
   *  infers the opposite. */
  readonly default?: string

  readonly optional?: true
  /** Required only under this condition — stated, never left to be inferred.
   *  When the condition names an OPTIONAL parameter, say what that parameter
   *  defaults to: "trigger is cron" is unreadable when `trigger` was omitted
   *  and the effective value is cron anyway. */
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
  /** One of the declared verbs ({@link BOARD_VERBS}). */
  readonly verb: BoardVerb
  readonly domain: ActionDomain
  readonly lane: ActionLane
  readonly danger: ActionDanger
  /** One sentence, for the model: what this action DOES (not how to spell it). */
  readonly summary: string
  readonly params: Readonly<Record<string, ParamSpec>>
  readonly surface: ActionSurface
  /**
   * The CARRIER this action's effect travels on when a non-engine replica has
   * to ask the engine for it — the carrier's name, and with it what that carrier
   * MEANS: `run` runs the card named by `of`; `comment` puts a line of text into
   * a named session; `session.create` opens a session and binds it; and so on.
   *
   * WHOSE FACT THIS IS: the engine owns the carriers, and the catalog owns which
   * actions ride which one. A relay that decides by reading action NAMES is a
   * relay that will one day forward an action onto a carrier that cannot carry
   * it — and that day is silent: a comment forwarded as a run spends a run and
   * delivers no text. So "which carrier" is a field in this table, and the host
   * only switches on it.
   *
   * OPTIONAL ON PURPOSE, and its absence is a statement rather than a gap: an
   * action with NO `relay` cannot be relayed at all, whatever its lane. That
   * covers both "the engine does this itself" and "this writes a document
   * instead" — and it is the one thing a host must refuse rather than guess.
   */
  readonly relay?: 'run' | 'comment' | 'session.create' | 'session.rename'
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
 * WHAT A DATE PARAMETER ACTUALLY IS, in one string every date parameter carries.
 *
 * Three surfaces read the same three fields and none of them agreed: the catalog
 * said 「毫秒时间戳」, the interface's `<input type="date">` produces LOCAL
 * MIDNIGHT (a date is a day, and the reader's day is theirs rather than UTC's),
 * and `datePostureOf` judges by whole local-day boundaries. A model that
 * believed the catalog sent the current instant, and the row came out overdue at
 * 00:00:00.001.
 *
 * So it is a FIELD, on every date-writing action, carrying the same value — which
 * is what makes it readable by a schema renderer rather than only by whoever
 * reads the prose. 「说清不等于说得进去」: a default stated in a sentence is not a
 * default anything can check. And it is ONE constant rather than six literals,
 * because six copies of a sentence that has to agree are six things that can
 * drift — the reader of the field is the const, and the const is the one place
 * the rule is written down.
 *
 * (A gate reading this file as TEXT has to resolve the reference; the field's
 * being a constant is the same kind of thing as `oneOf: MOVABLE`, which the
 * catalog has always done.)
 */
const DATE_GRANULARITY = '毫秒时间戳，但它标的是一「天」：给本地零点，别给「现在」。界面日期框交出来的就是本地零点，读取也按本地整天边界判断，所以 UTC 正午会在界面上显示成前一天。'

/**
 * THE CATALOG. Keyed by action id; the id set is the closed `ActionId` union,
 * so an action that exists but was never described here cannot be referenced,
 * and a description without an implementation is a visible hole rather than a
 * silent one.
 *
 * Ids read `<subject>.<verb>`. The subject is the thing acted on (`task`,
 * `item`, `board`, `cruise`, `rule`, `session`, `preset`); the verb is one of
 * the declared ones. `domain` says which document the action speaks about,
 * which is not always the subject: a rule belongs to the session domain, a
 * cruise switch to the board's.
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
      bind: {
        about: '建卡时直接挂上的来源（可多项）：kind 是 session 时给 { kind, sessionId }，是 workspace 时给 { kind, workspaceId }',
        optional: true,
        list: 'object',
      },
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
    semantic: true,
    semanticOf: 'moveTaskToStatus',
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
    summary: '通过一张待审核的卡：一次动作做两件事——把已读钟推到此刻，并把它移到「已完成」（动词是 move，但读状态也一起变了，所以别拿它当纯移栏用）。真有轮次还在跑时整条拒绝，状态与已读都不动；这时候该做的是等这次运行结算完再来，而不是换个动作绕过去。',
    semantic: true,
    semanticOf: 'moveTaskToStatus',
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
    semantic: true,
    semanticOf: 'armSchedule',
    params: {
      of: { about: '要排期的卡' },
      enabled: {
        about: '上膛还是解甲',
        optional: true,
        boolean: true,
        // The surprising one: not passing it does NOT mean "on".
        default: '不传 = 沿用这张卡现在的上膛状态；卡上还没有规则时不传等于关',
      },
      mode: { about: 'cron 定时 / chain 完成后接续', optional: true, oneOf: ['cron', 'chain'], default: '不传 = cron' },
      cron: { about: '五段 cron 表达式', requiredWhen: 'mode 是 cron（mode 不传时有效值就是 cron）；解甲不必给' },
      maxRuns: { about: '最多跑几次', optional: true, appliesWhen: '留空 = 不限次' },
    },
  },
  'task.run': {
    verb: 'run',
    domain: 'board',
    lane: 'engine',
    danger: 'guarded',
    surface: 'ui+ai',
    // The one action whose carrier is a run.
    relay: 'run',
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
    // A comment rides its OWN carrier, not the run one: it has to reach a
    // session, and forwarded as a run it would spend a run and deliver no text.
    relay: 'comment',
    summary: '对某个会话说一句话，接着上次的对话继续。它骑的是**发言**那条载波，不是 run 载波——**走 run 中继只会白跑一次卡，那句话一个字也发不出去**。排队还是插话由用户的开关定，不接受指定。',
    params: {
      of: { about: '目标卡' },
      session: { about: '目标会话', requiredWhen: '这张卡挂了不止一个会话时必须指明' },
      text: { about: '要发的话' },
      command: { about: '这是一条斜杠命令而不是一句话', optional: true, boolean: true },
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
      // 'all' was missing from the range while the reason on `of` named it —
      // a table that cites a value its own range excludes reads as broken.
      // `default` is a field, not a sentence inside the condition: a condition
      // that names an optional parameter is unreadable unless the omitted case
      // is stated where a reader (and a gate) can find it.
      scope: {
        about: '标到哪一层',
        optional: true,
        oneOf: ['task', 'session', 'round', 'all'],
        default: '不传 = 整张卡（等价于 markAllViewed 那一路）',
      },
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
      enabled: { about: '开还是关', optional: true, boolean: true, default: '不传 = 保持现在的开关状态' },
      limit: { about: '同时跑几条', optional: true, range: { min: 1, max: 20 }, default: '不传 = 保持现在的上限；超出 1..20 会被夹到边界' },
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
      trigger: { about: 'cron 定时 / on-complete 每次跑完', optional: true, oneOf: ['cron', 'on-complete'], default: '不传 = cron' },
      cron: { about: '五段 cron 表达式', requiredWhen: 'trigger 是 cron（trigger 不传时有效值就是 cron，所以照样要给）' },
      usePrompt: {
        about: '送这张卡当前的执行 Prompt，而不是自定义文本',
        optional: true,
        boolean: true,
        default: '不传 = 送自定义文本（也就是要一起给 instruction）',
      },
      instruction: { about: '要定时送出去的话', requiredWhen: 'usePrompt 是 false（usePrompt 不传时有效值就是 false，所以照样要给）' },
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
      enabled: { about: '上膛还是解甲', optional: true, boolean: true, default: '不传 = 这次不动它的上膛状态' },
      trigger: { about: 'cron 定时 / on-complete 每次跑完', optional: true, oneOf: ['cron', 'on-complete'], default: '不传 = 沿用这条规则现在的触发方式' },
      cron: { about: '五段 cron 表达式', requiredWhen: 'trigger 是 cron（trigger 不传时有效值沿用当前，当前是 cron 就仍然要给）' },
      usePrompt: {
        about: '送执行 Prompt 而不是自定义文本',
        optional: true,
        boolean: true,
        default: '不传 = 送自定义文本（也就是要一起给 instruction）',
      },
      instruction: { about: '要定时送出去的话', requiredWhen: 'usePrompt 是 false（usePrompt 不传时有效值就是 false）' },
      send: { about: '排队还是插话', optional: true, oneOf: ['queue', 'steer'] },
    },
  },
  'rule.delete': {
    verb: 'delete',
    domain: 'session',
    lane: 'document',
    /** `guarded`, NOT `reversible`, and the definition this file carries above is
     *  what makes it so: reversible means undoing it is an ORDINARY action, and
     *  here undoing it means retyping the instruction, the trigger and the cron
     *  by hand. A card delete is `irreversible` for the sharper reason that a
     *  checklist row has a tombstone and a card does not; a rule is the softer
     *  half of the same honesty problem — the text is the reader's, it is simply
     *  not gone forever, only gone unless they feel like typing it again.
     *
     *  And it has to be corrected HERE rather than only in the interface. Hard
     *  rule 12 makes this catalogue the only synchronisation surface between the
     *  panel and the model, so a UI that asks 「are you sure」 while this file
     *  says `reversible` is the panel and the model disagreeing about the same
     *  action — and the model is the one that cannot see the dialog. */
    danger: 'guarded',
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
    // Opening a session is not running a card; it rides the carrier that opens a
    // session, and forwarded as a run it would build no session at all.
    relay: 'session.create',
    summary: '按给定的运行配置建一条新的原生会话，**并且同时把它挂到这张卡上**——所以这条既是 create 也是 bind，不给 of 就没法用（要挂来源但不想建会话，去 session.bind）。它骑的是**建会话**那条载波，不是 run 载波——**走 run 中继同样只会白跑一次卡，会话不会被建出来**。卡本身不动：不产生执行记录、不进派发队列、不碰任何自动化。会话是原生侧真实存在的东西，绑定可以摘掉，关掉它要用户自己在原生界面做。会话创建在宿主缺席时直接失败，不会假装排队。',
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
    summary: '给卡挂一个来源：一个会话，或一个整个工作区。一次加一个（两个参数二选一，不是都填）。',
    params: {
      of: { about: '目标卡' },
      session: { about: '要挂的会话', requiredWhen: '没给 workspace 时必填（与 workspace 二选一）' },
      workspace: { about: '要挂的工作区', requiredWhen: '没给 session 时必填（与 session 二选一）' },
    },
  },
  'session.remove': {
    verb: 'delete',
    domain: 'session',
    lane: 'document',
    danger: 'guarded',
    surface: 'ui+ai',
    summary: '把一个会话从卡上永久摘掉（连它的轮次一起）。这是删除，不是隐藏。',
    semantic: true,
    semanticOf: 'removeSessionFromTask',
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
    // Renaming is not running: it rides the rename carrier, and forwarded as a
    // run it would cost a run and change no name.
    relay: 'session.rename',
    summary: '给一个会话改它的显示名——改的是**原生侧那条会话**的名字，不是插件里这张卡的标题（卡标题走 task.update 的 title）。**不用先知道是哪张卡**：这条动作的目标就是那条会话，而它会不会出现在某张卡上由那张卡的 binds 决定，与改名无关（为改个名字先去查一遍卡，是凭空多一轮）。动词是 update，宾语却在插件之外。它骑的是**改名**那条载波，不是 run 载波——**改名字不触发任何执行，走 run 中继同样只会白跑一次卡，名字不会改**。',
    params: {
      // No `of`: a required parameter with nowhere to sit in the carrier is a
      // parameter that can never be satisfied, and the tool must not invent a
      // field to satisfy it. What gets renamed is the session; which cards show
      // it is their binds' business, not this action's.
      session: { about: '要改名的会话（会话 id）' },
      title: { about: '新名字' },
    },
  },
  'session.reorder': {
    verb: 'update',
    domain: 'session',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    summary: '调整卡上会话列表的显示顺序（只改顺序，一个字段都不改）。',
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
      // The discriminator: two conditionally-required parameters with nothing to
      // choose between them is a condition set no caller can satisfy.
      scope: { about: '动的是哪一行', oneOf: ['session', 'round'] },
      session: { about: '要收起的会话', requiredWhen: 'scope 是 session' },
      round: { about: '要收起的轮次', requiredWhen: 'scope 是 round' },
      hidden: { about: '收起还是恢复', boolean: true },
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
      config: {
        about: '运行配置（只给要钉住的那几项，其余走默认）',
        requiredWhen: 'kind 是 run',
        object: ['workspaceId', 'provider', 'model', 'reasoningEffort', 'agentPreset', 'permission'],
      },
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
      config: {
        about: '新的运行配置（只给要改的那几项）',
        optional: true,
        appliesWhen: '只对运行配置预设',
        object: ['workspaceId', 'provider', 'model', 'reasoningEffort', 'agentPreset', 'permission'],
      },
      makeDefault: { about: '设为默认 / 取消默认', optional: true, boolean: true, appliesWhen: '只对运行配置预设' },
    },
  },
  'preset.delete': {
    verb: 'delete',
    domain: 'preset',
    lane: 'document',
    /** `guarded` for the same reason as `rule.delete`, and with more behind it:
     *  `persist` OVERWRITES the whole section, so this is the end of a name and
     *  up to six configuration fields the reader typed, on every device at once.
     *  「恢复默认」 next to it in the same dialog is `reversible` in the strict
     *  sense — it re-adds the built-ins that were never deleted — and that is
     *  exactly the sort of difference this field exists to say out loud. */
    danger: 'guarded',
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
    // The four checklist writes are `semantic` for the same reason the card's
    // are: each one carries meaning a field write does not — a fresh row's
    // constructor and its step ids, the no-op law, the "only that one entry
    // moves" law, the difference between "gone from the list" and "erased". The
    // panel and this tool must go through the SAME function for each, and
    // `semanticOf` is what makes that checkable instead of a convention.
    semantic: true,
    semanticOf: 'captureItemRecord',
    summary: '记一条清单条目。标题可以留空（会从正文首行补），步骤只有一层、进度自动算。',
    params: {
      body: { about: '正文，Markdown' },
      title: { about: '一行标题', optional: true },
      notes: { about: '给接手的人或模型看的上下文备注', optional: true },
      // The element shape is declared because guessing it loses data: a plain
      // string list has no id, and an id-less entry is dropped by the inbound
      // grammar — taking the whole item with it, while reporting success.
      steps: {
        about: '勾选清单（只有一层）',
        optional: true,
        list: { about: '一步：text 是那行字，done 是勾没勾；id 由文档分配，不要自己编', object: ['text', 'done'] },
      },
      status: { about: '开放 / 受阻 / 完成', optional: true, oneOf: ITEM_STATUS_VALUES },
      priority: { about: '四档优先级', optional: true, oneOf: ITEM_PRIORITY_VALUES },
      tags: { about: '自由标签', optional: true, list: 'string' },
      // The granularity is a FIELD on all three dates, and in the same words.
      // It used to be 「毫秒时间戳」 in `about` here and nothing at all in
      // `item.update`, which is a third reading of the same three fields.
      startsAfter: { about: '最早开始', optional: true, default: DATE_GRANULARITY },
      dueAt: { about: '截止', optional: true, default: DATE_GRANULARITY },
      hardDueAt: { about: '最后期限', optional: true, default: DATE_GRANULARITY },
      taskId: { about: '关联的看板卡片（零张或一张）', optional: true },
    },
  },
  'item.update': {
    verb: 'update',
    domain: 'item',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    semantic: true,
    semanticOf: 'applyItemPatch',
    summary: '改一条清单条目（用 #编号 指它）。只改传了的字段；编号与来源不可写。',
    params: {
      of: { about: '要改的条目编号：填那个数字本身（12），不要带 # 号——# 只是它显示时的样子' },
      title: { about: '一行标题', optional: true },
      body: { about: '正文，Markdown', optional: true },
      notes: { about: '上下文备注', optional: true },
      steps: {
        about: '勾选清单（整份替换，只有一层）',
        optional: true,
        list: { about: '一步：text 是那行字，done 是勾没勾；id 由文档分配，不要自己编', object: ['text', 'done'] },
      },
      status: { about: '开放 / 受阻 / 完成（「进行中」是派生的，不可写）', optional: true, oneOf: ITEM_STATUS_VALUES },
      priority: { about: '四档优先级', optional: true, oneOf: ITEM_PRIORITY_VALUES },
      tags: { about: '自由标签（整份替换）', optional: true, list: 'string' },
      // The same field, the same value, for the same reason as `item.create`'s.
      startsAfter: { about: '最早开始', optional: true, default: DATE_GRANULARITY },
      dueAt: { about: '截止', optional: true, default: DATE_GRANULARITY },
      hardDueAt: { about: '最后期限', optional: true, default: DATE_GRANULARITY },
      taskId: { about: '关联的看板卡片', optional: true },
    },
  },
  'item.delete': {
    verb: 'delete',
    domain: 'item',
    lane: 'document',
    danger: 'guarded',
    surface: 'ui+ai',
    semantic: true,
    semanticOf: 'removeItemRecord',
    summary: '删一条清单条目。走墓碑，所以能恢复；但没有撤销层，删之前值得先说一句。',
    params: {
      of: { about: '要删的条目编号：填那个数字本身（12），不要带 # 号' },
    },
  },

  'item.step': {
    // Its own action rather than a wider `item.update`, and the reason is that
    // `update` replaces the WHOLE step list: a model ticking one box would have
    // to resend every step, and a list it resends from memory is a list it can
    // shorten. One verb per shape the model reasons about, rather than one verb
    // with a mode switch.
    verb: 'update',
    domain: 'item',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    semantic: true,
    semanticOf: 'applyItemStep',
    summary: '勾掉或取消勾选某一条里的某一步。只动那一步，别的步骤和别的字段都不碰。',
    params: {
      of: { about: '条目编号：填那个数字本身（12），不要带 # 号' },
      step: { about: '那一步的 id。它是清单里那一行勾选框的身份，先查一次拿到它' },
      done: { about: 'true 勾上，false 取消勾上', boolean: true },
    },
  },

  'item.promote': {
    // THE ONE ACTION THAT WRITES TWO DOCUMENTS, so the receipt names both rather
    // than saying a subject-less 「已生效」 — see `OpReport.documents` on the tool
    // side, which is where the half-landed case is actually said out loud. The
    // comment here used to point at `applyOne` for that sentence; `applyOne`
    // never said it, which is a promise in a comment that nothing keeps.
    //
    // It carries `semantic` for the same reason the other four checklist writes
    // do, and it was MISSING it: the panel's 转成卡片 button and this tool both
    // call `planItemPromotion`, so the judgment 「这一条能不能变成卡」 was already
    // decided in one function — while the catalog said the action had no shared
    // semantics, which is precisely the state in which somebody grows a second
    // judgment beside it and the two disagree. The binding is recorded in
    // {@link ITEM_HANDLERS}, and `actionCatalogFindings` holds the two to each
    // other so they cannot drift.
    verb: 'create',
    domain: 'item',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    semantic: true,
    semanticOf: 'planItemPromotion',
    summary: '把一条清单条目变成一张看板卡片，并把两边互相链接。清单这一条不消失——它已经是那张卡的来处，链接上了以后它会带着卡一起显示。',
    params: {
      of: { about: '要提升的条目编号：填那个数字本身（12），不要带 # 号' },
      cardTitle: { about: '给新卡换个标题；不填就用清单这一条的标题', optional: true },
      cardPrompt: { about: '给新卡的执行 Prompt（卡真正跑起来送出去的那段）；不填就用清单这一条的正文', optional: true },
    },
  },

  'item.ask': {
    // THE ONE THE PANEL HAD AND THE CATALOG DID NOT. The panel's 「问一句」
    // button called a private route function, so `verify-action-coverage` — which
    // reads what the CATALOG carries — could not see it, and a model had no way
    // to ask a question about a row it had just read. 「界面有的动作 AI 没有」
    // was not an oversight; it is what happens when a judgment lives in a route
    // instead of in a function the catalog can name. It lives in
    // `src/core/item-ask.ts` now, both callers go through it, and it is here.
    verb: 'speak',
    domain: 'item',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    semantic: true,
    semanticOf: 'planItemAsk',
    summary: '把一条清单条目交给模型，问它关于这一条的事并让它回话。只会送到这一条自己挂着的那张卡的会话上：优先送正在跑的那个，没有就送第一个。这一条不是执行——不会开一轮、不会动看板上的栏位，只是把这个条目（连同它的步骤）作为一句话送进一个会话。想让它真的去做，用 item.promote 先变成卡，再在卡上开工。',
    params: {
      of: { about: '要问的条目编号：填那个数字本身（12），不要带 # 号', appliesWhen: '这一条必须已经挂在一张看板卡片上：没有卡的条目没有会话可以说话，会被拒。' },
    },
  },

  'item.restore': {
    // Its own verb, not `create`: the row already exists in the document, held
    // behind a tombstone. Re-creating it would be a second row with a second
    // number, and the number is the thing a person says out loud.
    verb: 'restore',
    domain: 'item',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui+ai',
    // `semantic` for the same reason as the other five checklist writes, and the
    // binding check caught this one missing: the panel's undo reaches it through
    // the host service and the model reaches it through the tool, and BOTH go
    // through `restoredItemOf`, whose whole job is re-stamping the row above the
    // tombstone it has to outrank. Two callers that each did that arithmetic would
    // be two documents that could disagree about whether a restore worked.
    semantic: true,
    semanticOf: 'restoredItemOf',
    summary: '把一条删掉的清单条目找回来。删除走的是墓碑，条目本身还在，所以是原样回来，不是重建一条新的。',
    params: {
      of: { about: '要恢复的条目编号：填那个数字本身（12），不要带 # 号' },
    },
  },

  'item.purge': {
    // Its own action and not a second `item.delete`, because the two halves of a
    // deletion are different verbs with different prices: the first can be
    // taken back and the second cannot. `item.delete` is `guarded` for exactly
    // that reason, and an action that quietly carried both prices would let a
    // model learn that deleting is cheap.
    //
    // The verb is `delete` because it deletes — a fourteenth verb for a thing
    // that is already in the list would teach the next reader of `BOARD_VERBS`
    // that 「删」 means two different things, and the `danger` field is where
    // 「this one is final」 belongs (it is what the tool's dry-run sentence and
    // the capability view both read).
    verb: 'delete',
    domain: 'item',
    lane: 'document',
    // The one irreversible checklist action, and the only honest answer: there
    // is no tombstone left holding the text afterwards, so nothing brings it
    // back. `item.delete` is `guarded` rather than irreversible precisely
    // because the tombstone makes it recoverable — this is the one that closes
    // that door, so it is the one a caller should rehearse first.
    danger: 'irreversible',
    surface: 'ui+ai',
    // `semantic` for the reason the other five carry it: the archive drawer and
    // the tool both have to answer 「这一条还能不能找回来」, and the answer is
    // decided by whether the tombstone still holds text. Two callers each
    // guessing that would be two surfaces that disagree about whether a
    // deletion is still recoverable.
    semantic: true,
    semanticOf: 'purgeItemTombstone',
    summary: '把一条已删除的清单条目彻底清掉：连墓碑里留着的正文一起扔掉，撤不回来。只想让它从清单里消失就用删除（那个还能找回）。对着还没删过的条目用这一条会被拒。',
    params: {
      of: { about: '要清掉的条目编号：填那个数字本身（12），不要带 # 号' },
    },
  },

  'item.navigate': {
    // `ui`, like every other navigation: "open this" means nothing in another
    // context, and a model that could retarget a person's screen would be a
    // bug with a good PR. Listed rather than omitted so the coverage check can
    // see that the interface grew it and the tool deliberately cannot reach it.
    verb: 'navigate',
    domain: 'item',
    lane: 'document',
    danger: 'reversible',
    surface: 'ui',
    // `semantic` for the same reason every other checklist row carries it, and
    // the binding check caught this one missing while it was NOT_YET_BUILT: the
    // panel had 「go to a page」 and 「focus a row」 as two pieces of local state
    // with no named function behind them, so 「#12 belongs to which page」 was a
    // question only a React component could answer. It is in `item-navigate.ts`
    // now, next to the two predicates that decide it.
    semantic: true,
    semanticOf: 'planItemNavigation',
    summary: '把清单面板切到某个页面，或者聚焦到某一条。只给编号就跳到那一行所在的那一页；两样都给就照给的来。只有界面能调：模型不替人翻界面。',
    params: {
      page: {
        about: '要去哪个页面',
        optional: true,
        // The page set is the interface's, and this reads it from there rather
        // than keeping a copy: a second list of page ids is a list that starts
        // lying the first time a page is added, and a model offered a page
        // that does not exist gets a failure it cannot explain.
        oneOf: ITEM_PAGES,
        default: '不传 = 留在当前页，只聚焦某一条',
      },
      of: { about: '要聚焦的条目编号：填那个数字本身（12），不要带 # 号', optional: true },
    },
  },
} as const satisfies Record<string, ActionShape>

/** Every action the catalog declares. The closed union every other type keys on. */
export type ActionId = keyof typeof ACTIONS

/** The checklist's actions, DERIVED from {@link ActionId} rather than listed. */
export type ItemActionId = Extract<ActionId, `item.${string}`>

/**
 * The core function one action's effect travels through.
 *
 * THE UNION OF WHAT THE TWO MODULES ACTUALLY EXPORT, derived rather than written
 * out — so the table's value type cannot fall behind the code, and a new shared
 * function is bindable the moment it is exported. It is a union of real
 * signatures, not an erased `(...args: never[]) => never`: an erased type would
 * have let this table name a function that does not exist, which is the one
 * thing this table exists to prevent.
 *
 * BOTH modules, because the checklist's write path is not all in one file: the
 * restore re-stamp belongs to the document grammar (the tombstone it has to
 * outrank is the grammar's), so binding `item.restore` to `item-transitions`
 * would have pointed the gate at the wrong module.
 *
 * Now THREE, and the third is the hand-off: which conversation a row's words go
 * to is a judgment about the row AND the card together, so it is not a member of
 * either of the two above.
 */
type ItemHandler =
  | (typeof itemTransitions)[keyof typeof itemTransitions]
  | (typeof itemsDocument)[keyof typeof itemsDocument]
  | (typeof itemAsk)[keyof typeof itemAsk]
  | (typeof itemNavigate)[keyof typeof itemNavigate]

/** The marker a {@link NOT_YET_BUILT} reason must start with. */
const NOT_YET_BUILT_MARKER = 'NOT-YET-BUILT: '

/**
 * Actions this catalog describes that have NO core binding, each with the reason
 * — the checklist half of the ledger the gate keeps for controller methods.
 *
 * AN EXEMPTION WITHOUT A REASON IS A FORGOTTEN ACTION. So the marker is its own
 * word, it is its own VERDICT (this one means "the catalog describes it and no
 * single implementation answers it yet", which is the opposite end from "we
 * forgot to tell the model"), and a bare marker records a decision while
 * documenting no decision. The gate counts them separately from a real debt so
 * neither number can hide inside the other.
 *
 * THE ONLY ENTRY IS ONE NOBODY NOTICED. `item.navigate` is `surface: 'ui'`, so the
 * model is never offered it and the tool-side debt table does not apply — which
 * left it with no check at all, in three places at once: this catalog, the
 * capability query, and a spec pinning the ui-only list. Meanwhile the panel has
 * no single function that "go to a page, or focus a row" could call: page and
 * selection are two pieces of the panel's own state, the same class of UI the
 * controller-method scan cannot see. So the honest state is the one recorded
 * here, not a `semanticOf` naming a function nobody wrote.
 */
/**
 * The ledger of catalogued actions with no core binding.
 *
 * **EMPTY, and that is the point.** It used to hold one row —
 * `item.navigate` — with a reason saying the judgment lived in the panel's local
 * state and no gate could see it. The judgment 「#12 在哪一页」 now lives in
 * `item-navigate.ts` next to the two predicates that decide it, so the row has a
 * function to bind to and this ledger has nothing left to excuse.
 *
 * The type is still here and still enforced: `BoundItemActionId` excludes it, so
 * a new item action is a BUILD FAILURE until it is either bound or written here
 * with a reason. An empty ledger means every listed action is implemented — and
 * a future `item.*` that arrives without a binding cannot join the catalog
 * quietly, which is the only reason the escape hatch is worth keeping.
 */
export const NOT_YET_BUILT: Partial<Record<ActionId, string>> = {}

/** Every checklist action that must be bound to a core function to be legal. */
type BoundItemActionId = Exclude<ItemActionId, keyof typeof NOT_YET_BUILT>

/**
 * WHICH CORE FUNCTION EACH CHECKLIST WRITE GOES THROUGH — the binding the
 * coverage gate could not see.
 *
 * WHY IT HAD TO BE BUILT. Every other verb in this catalog is bound to a
 * `BoardController` method, and the gate finds it by scanning for
 * `controller.method()` across `src/client`. The checklist's writes are NOT
 * controller methods: the panel calls the shared pure functions directly
 * (`applyItemPatch` / `applyItemStep` / `captureItemRecord` / …) because the
 * model has to call the same ones. So the gate had nothing to recognise, and the
 * consequence is the worst kind: **a button added to the checklist and never
 * told to the model leaves the gate green**. Not "green by luck" — green by
 * construction, because the syntax it looks for is not in that file at all.
 *
 * THE KEY SET IS THE TYPE, AND THE EXEMPTION IS PART OF IT.
 * `satisfies Readonly<Record<BoundItemActionId, ItemHandler>>` means an action
 * cannot be added without deciding here what implements it — and the decision is
 * a VALUE, either a real function or a written reason. That is the same move as
 * deriving the patch type from `ITEM_FIELDS`, for the same reason: a hand-kept
 * list of "what each action calls" stops agreeing with the real one the first
 * time somebody adds an action, and nothing about the old list looks wrong when
 * it does.
 *
 * Written as `Record<ItemActionId, …>` the very first compile of this table
 * failed on `item.navigate` — the one action in the catalog nobody has ever
 * built. That is the gate working: a new checklist action now fails the build
 * until it is either bound or reasoned about, and neither can happen quietly.
 *
 * `ItemActionId` is derived by PREFIX rather than listed, so a new domain in the
 * catalog does not have to be added here to keep this table honest.
 */
export const ITEM_HANDLERS = {
  'item.create': itemTransitions.captureItemRecord,
  'item.update': itemTransitions.applyItemPatch,
  'item.delete': itemTransitions.removeItemRecord,
  'item.step': itemTransitions.applyItemStep,
  'item.promote': itemTransitions.planItemPromotion,
  // The hand-off half is `item-ask`'s, for the same reason the restore half is
  // `items-doc`'s: which session a row's words go to is a judgment about the CARD
  // and the row together, and a function in the route would have answered it a
  // second time for the model. Naming the wrong module here would be a binding to
  // a function that exists and is not the one the panel calls.
  'item.ask': itemAsk.planItemAsk,
  // The jump is a DOCUMENT question — 「#12 在哪一页」 is answered by the same
  // `isInboxItem` / `isAgendaItem` that decide membership everywhere else — and
  // the panel only moves once this has answered it. Binding it the other way
  // round would have left the only place that knows the page set inside a
  // component, which is where this row lived for as long as it was unbuilt.
  'item.navigate': itemNavigate.planItemNavigation,
  // The restore half is `items-doc`'s, not `item-transitions`' — it is the same
  // re-stamp-above-the-tombstone rule the panel's undo goes through, and it
  // belongs to the merge grammar because the tombstone it has to outrank is the
  // grammar's. Naming the wrong module here would be a binding to a function
  // that exists and is not the one both surfaces call.
  'item.restore': itemsDocument.restoredItemOf,
  // The purge half is `items-doc`'s for the same reason the restore half is, and
  // the reason is not tidiness: what a purge writes is a tombstone's own field,
  // so the merge grammar is the module that owns the question, and a function
  // in `item-transitions` would have had to answer 「墓碑里还有没有正文」 without
  // ever seeing a tombstone.
  'item.purge': itemsDocument.purgeItemTombstone,
} as const satisfies Readonly<Record<BoundItemActionId, ItemHandler>>

/**
 * {@link ITEM_HANDLERS} by NAME, read off the table itself rather than written
 * out beside it.
 *
 * The same argument as {@link SEMANTIC_FUNCTIONS}: a second list of names is a
 * thing to keep in step with the code, and the day it stops agreeing nothing says
 * so. Read off the table, a rename moves both at once and a binding that was
 * deleted stops vouching for itself the same moment.
 */
export const ITEM_HANDLER_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(ITEM_HANDLERS).map(([id, fn]) => [id, fn.name]),
)

/**
 * The model's three date fields — the parameters whose GRANULARITY is a decision
 * rather than a type, and so has to be stated rather than inferred.
 *
 * Named as the model's field names on purpose: the check asks "does this
 * parameter say what a date means", and a fourth date in the model is then a
 * four-character edit here rather than a fourth place to forget the sentence.
 */
const ITEM_DATE_PARAMS: ReadonlySet<string> = new Set(['startsAfter', 'dueAt', 'hardDueAt'])

/** The verbs, as data — the coverage gate and any renderer read this, never a
 *  second hand-written list. `query` is the read lane's verb and has no action
 *  here on purpose: a query is not a change, and its shape comes from the
 *  qualifier registry, not from a row in this table. */
export const BOARD_VERBS: readonly BoardVerb[] = [
  'create', 'update', 'move', 'delete', 'run', 'speak', 'bind', 'automate', 'cruise', 'ack', 'navigate', 'restore', 'query',
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
  dry_run: { about: '只演练不落盘：整批在文档克隆上跑，返回会改什么', optional: true, boolean: true },
  /**
   * NOT a boolean, and the fact that it is a string is stated by its ABSENCE of
   * `boolean` — which is why the renderer below has to read the shape field
   * rather than assume one. It used to publish as `type: 'boolean'` because the
   * whole envelope was stamped with that type, so a model obeying the published
   * schema sent `true`; the reader guards on `typeof === 'string'`, the key came
   * out empty, and the retry-safety promise did nothing at all while the schema
   * said it was in force. **A promise published in the wrong shape is worse than
   * no promise, because the caller is told it is protected.**
   */
  idempotencyKey: { about: '幂等键：同一个键重试不会重复执行、不会重复烧钱；自己编一个稳定字符串，重试时原样再发一遍', optional: true },
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
  /**
   * Which core function each checklist action binds to, keyed by action id. The
   * real table is {@link ITEM_HANDLERS}.
   *
   * Injectable for the same reason as everything else here: a check that has only
   * ever passed against the real table is indistinguishable from a check that
   * cannot fail, so the tests feed it a deliberately broken copy and assert each
   * new rule bites.
   */
  readonly itemHandlers?: Readonly<Record<string, string>>
  /** The "described but not bound" ledger. The real one is {@link NOT_YET_BUILT}. */
  readonly notYetBuilt?: Readonly<Record<string, string>>
}

/**
 * The shared semantic implementations that really exist, READ FROM THE MODULE
 * rather than from a second list beside it. A list would be a thing to keep in
 * step with the code: rename a function and the list keeps vouching for a name
 * that no longer resolves. Read from the module, a rename simply stops existing
 * and the action that named it goes red on its own — which is the whole point
 * of `semantic` in the first place.
 *
 * BOTH transition modules AND the document grammar, because the checklist is the
 * second synced document and its write path used to be a SECOND COPY of the same
 * semantics: a panel that edits a row through its own function and a model that
 * edits it through the tool can compute two different documents, which is the one
 * failure two devices cannot detect between them.
 *
 * The document grammar is in this list because `restoredItemOf` lives there: the
 * restore re-stamp belongs to the merge grammar (the tombstone it has to outrank
 * is the grammar's), so a registry built from the two transition modules alone
 * would have reported a shared function that both surfaces really call as one
 * that does not exist — which is the one failure this registry exists to prevent,
 * pointing the other way.
 */
const SEMANTIC_FUNCTIONS: Record<string, true> = Object.fromEntries(
  [...Object.keys(taskTransitions), ...Object.keys(itemTransitions), ...Object.keys(itemsDocument), ...Object.keys(itemAsk), ...Object.keys(itemNavigate)].map(name => [name, true]),
)

/** What the catalog itself guarantees. Mechanical, so it costs nothing to keep
 *  honest: the coverage gate runs this over the real table, and the tests run it
 *  over deliberately broken copies to prove it is not a rubber stamp.
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
  const semantic = checks.semantic ?? SEMANTIC_FUNCTIONS
  const verdictsByDomain: Partial<Record<ActionDomain, Readonly<Record<string, FieldSpec>>>> = {
    board: checks.taskFields ?? TASK_FIELDS,
    item: checks.itemFields ?? ITEM_FIELDS,
  }
  const handlers: Readonly<Record<string, string | undefined>> = checks.itemHandlers ?? ITEM_HANDLER_NAMES
  const notYetBuilt: Readonly<Record<string, string | undefined>> = checks.notYetBuilt ?? NOT_YET_BUILT
  const findings: string[] = []
  for (const [id, spec] of Object.entries(table)) {
    if (!BOARD_VERBS.includes(spec.verb)) findings.push(`${id}: verb "${spec.verb}" is not one of the declared verbs`)
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
      // A DATE PARAMETER MUST CARRY ITS GRANULARITY. Every date the checklist
      // holds is a DAY a person typed, the interface produces local midnight and
      // the read side judges by whole local days — so "milliseconds" written in a
      // sentence is enough to make a model send 「now」 and produce a row that
      // reads as overdue at 00:00:00.001. The value has to be a FIELD, because a
      // default in prose is not a default anything can check.
      if (spec.domain === 'item' && ITEM_DATE_PARAMS.has(param) && p.default === undefined) {
        findings.push(`${id}.${param}: a date parameter with no \`default\` — the granularity and the local-midnight rule have to be a field, not a sentence (see DATE_GRANULARITY)`)
      }
    }
    // ── the checklist's binding, which the controller-method scan cannot see ──
    // Two statements about one action that must not disagree: the catalog row
    // says "this action means more than its field writes and both surfaces share
    // one function", and {@link ITEM_HANDLERS} says "here is that function". If
    // they drift, one of them is describing an action nobody implements — which
    // is the state a button added to the panel and never told to the model used
    // to be able to reach with the gate still green.
    if (spec.domain === 'item') {
      const bound: string | undefined = handlers[id]
      if (bound !== undefined) {
        if (spec.semantic !== true) {
          findings.push(`${id}: bound to the core function "${bound}" in ITEM_HANDLERS, so it must be marked semantic — a bound action that does not say so is an action the next reader will grow a second implementation beside`)
        } else if (spec.semanticOf !== bound) {
          findings.push(`${id}: ITEM_HANDLERS binds it to "${bound}" but the catalog names semanticOf "${spec.semanticOf}" — the binding and the claim are two statements about one action and they must be the same one`)
        }
      } else {
        const reason: string | undefined = notYetBuilt[id]
        if (reason === undefined) {
          findings.push(`${id}: a checklist action with no entry in ITEM_HANDLERS and none in NOT_YET_BUILT — bind it to the core function the panel and the tool both call, or record why there is not one`)
        } else if (!reason.startsWith(NOT_YET_BUILT_MARKER)) {
          findings.push(`${id}: its NOT_YET_BUILT reason does not start with "${NOT_YET_BUILT_MARKER}" — the marker is the verdict and the sentence after it is the decision; a bare one records a decision without documenting one`)
        } else if (reason.slice(NOT_YET_BUILT_MARKER.length).trim() === '') {
          findings.push(`${id}: marked NOT-YET-BUILT with no reason after the marker`)
        }
      }
    }
  }
  // The reverse direction: a ledger entry for an action that is bound, or that
  // the catalog does not declare at all. A paid debt left in the table is a red
  // light left burning on purpose, which is how an allow-list becomes
  // indistinguishable from a ledger.
  for (const id of Object.keys(notYetBuilt)) {
    if (handlers[id] !== undefined) findings.push(`NOT_YET_BUILT.${id}: it IS bound in ITEM_HANDLERS — decide which one is true and delete the other`)
    if (!(id in table)) findings.push(`NOT_YET_BUILT.${id}: names an action the catalog does not declare`)
  }
  return findings
}
