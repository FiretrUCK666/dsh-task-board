import type { TaskUpdatePatch } from './controller.ts';
import * as itemTransitions from './item-transitions.ts';
import { type FieldSpec } from './item.ts';
import * as itemsDocument from './items-doc.ts';
export type { FieldSpec };
/** The thirteen verbs. The table is a CONTRACT: a fourteenth verb is a decision,
 *  not a convenience, and the catalog is written to fit inside these. */
export type BoardVerb = 'create' | 'update' | 'move' | 'delete' | 'run' | 'speak' | 'bind' | 'automate' | 'cruise' | 'ack' | 'navigate' | 'restore' | 'query';
/** Which document a section of the surface speaks about. */
export type ActionDomain = 'board' | 'item' | 'preset' | 'session';
/**
 * How the effect travels. `document` writes the document (a Commit through the
 * merge grammar — the only lane that converges across devices). `engine`
 * needs the live host: a run, a session, a rename of a native session. The
 * distinction is not a style choice — a document write made while the engine is
 * offline is a fact on every device, while an engine write is a request that
 * may still be queued.
 */
export type ActionLane = 'document' | 'engine';
/**
 * What it costs to be wrong. `reversible` — undoing it is an ordinary action.
 * `guarded` — it is refused unless a stated condition holds, or it can only be
 * taken back by hand. `irreversible` — nothing brings it back.
 */
export type ActionDanger = 'reversible' | 'guarded' | 'irreversible';
/**
 * Who can reach it. `ui` — the model cannot (rule 2 above). `ui+ai` — both.
 * `ai-only` — the model only; there is no interface for it, which is a real
 * state of the world (an agent-originated row is the example) and must be
 * declared, never implied by absence.
 */
export type ActionSurface = 'ui' | 'ui+ai' | 'ai-only';
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
    readonly about: string;
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
    readonly oneOf?: readonly string[];
    /** The value is a boolean. Not `oneOf: ['true','false']` — that is a lie about
     *  the type, and the host would read the string as truthy or reject it. */
    readonly boolean?: true;
    /** A closed numeric interval, inclusive on both ends. */
    readonly range?: {
        readonly min: number;
        readonly max: number;
    };
    /** The value is an object with exactly these keys. A key the DOCUMENT owns is
     *  deliberately not among them, so the model is never asked to mint an id. */
    readonly object?: readonly string[];
    /** The value is a list: `'string'`, `'object'`, or a {@link ParamSpec}
     *  describing ONE element. Declaring the element is not optional politeness —
     *  an undeclared element shape is how a list of strings silently loses every
     *  row it is given. */
    readonly list?: 'string' | 'object' | ParamSpec;
    /** What an ABSENT key means, in one sentence. Needed whenever the default is
     *  not the obvious one — a parameter whose "not given" case means something
     *  surprising (here: switching something OFF) must say so, or the reader
     *  infers the opposite. */
    readonly default?: string;
    readonly optional?: true;
    /** Required only under this condition — stated, never left to be inferred.
     *  When the condition names an OPTIONAL parameter, say what that parameter
     *  defaults to: "trigger is cron" is unreadable when `trigger` was omitted
     *  and the effective value is cron anyway. */
    readonly requiredWhen?: string;
    /** Meaningless unless this holds — so a model does not invent it. */
    readonly appliesWhen?: string;
}
/**
 * Per-action parameter TYPING, keyed by action id. Deliberately empty: writing
 * parameter types before anyone has agreed on them would be a contract nobody
 * read, and an invented type is harder to remove than a missing one. The tool
 * schema knife adds entries here; until then every action's `params` is the
 * widened description table, and this interface is the seam it narrows.
 */
export interface ActionParamTypes {
}
/** The parameter table of one action: the per-action typing where it exists,
 *  the widened description table everywhere else. */
export type ActionParams<K extends ActionId> = K extends keyof ActionParamTypes ? ActionParamTypes[K] : Readonly<Record<string, ParamSpec>>;
/**
 * What an action IS — every field except the per-action typing of `params`.
 * Split out because the catalog table must be checkable against a type that
 * does not mention {@link ActionId}: the id union IS derived from that table,
 * so a shape depending on it would be circular (and a circular `satisfies`
 * silently degrades the table to `any` instead of failing where you meant).
 */
export interface ActionShape {
    /** One of the declared verbs ({@link BOARD_VERBS}). */
    readonly verb: BoardVerb;
    readonly domain: ActionDomain;
    readonly lane: ActionLane;
    readonly danger: ActionDanger;
    /** One sentence, for the model: what this action DOES (not how to spell it). */
    readonly summary: string;
    readonly params: Readonly<Record<string, ParamSpec>>;
    readonly surface: ActionSurface;
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
    readonly relay?: 'run' | 'comment' | 'session.create' | 'session.rename';
    /** Set when the action has meaning beyond its field writes, so the UI and the
     *  tool must share one implementation. Then `semanticOf` is required. */
    readonly semantic?: true;
    /** The shared core pure function this action must go through. */
    readonly semanticOf?: string;
}
/** What an action IS. Never how it is carried out — that is the lane's job. */
export interface ActionSpec<K extends ActionId> extends ActionShape {
    readonly params: ActionParams<K>;
}
/**
 * Every field the task patch may carry, ruled on. The key set is
 * `keyof TaskUpdatePatch`, so a field added to the patch without a verdict here
 * fails the build — the same law as {@link ITEM_FIELDS}, on the task side.
 */
export declare const TASK_FIELDS: Record<keyof TaskUpdatePatch, FieldSpec>;
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
export declare const ACTIONS: {
    readonly 'task.create': {
        readonly verb: "create";
        readonly domain: "board";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui+ai";
        readonly summary: "建一张新卡。执行 Prompt 是它能跑起来的唯一原因，所以必填。";
        readonly params: {
            readonly prompt: {
                readonly about: "执行 Prompt：这条卡跑起来时真正送出去的那段话";
            };
            readonly title: {
                readonly about: "一行标题";
                readonly optional: true;
                readonly appliesWhen: "留空时由执行 Prompt 补，不会覆盖已填的标题";
            };
            readonly description: {
                readonly about: "详情正文";
                readonly optional: true;
            };
            readonly status: {
                readonly about: "落哪一栏";
                readonly optional: true;
                readonly oneOf: readonly string[];
                readonly appliesWhen: "只能落在人手能拖过去的栏；「进行中」「待审核」归执行器";
            };
            readonly beforeId: {
                readonly about: "插到这张卡前面";
                readonly optional: true;
                readonly appliesWhen: "只在同一栏内排序时需要";
            };
            readonly bind: {
                readonly about: "建卡时直接挂上的来源（可多项）：kind 是 session 时给 { kind, sessionId }，是 workspace 时给 { kind, workspaceId }";
                readonly optional: true;
                readonly list: "object";
            };
        };
    };
    readonly 'task.duplicate': {
        readonly verb: "create";
        readonly domain: "board";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui+ai";
        readonly summary: "照着一张已有的卡复制一张新的（新的 id、新的编号，排期与规则不上膛）。";
        readonly params: {
            readonly of: {
                readonly about: "被复制的卡";
            };
        };
    };
    readonly 'task.update': {
        readonly verb: "update";
        readonly domain: "board";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui+ai";
        readonly summary: "改一张卡的字段。只改传了的字段；图片与文件不可写（没有上传通道，凭引用只会画出空白）。";
        readonly params: {
            readonly of: {
                readonly about: "要改的卡";
            };
            readonly title: {
                readonly about: "一行标题";
                readonly optional: true;
            };
            readonly description: {
                readonly about: "详情正文";
                readonly optional: true;
            };
            readonly prompt: {
                readonly about: "执行 Prompt";
                readonly optional: true;
            };
            readonly workspaceId: {
                readonly about: "跑在哪台机器上";
                readonly optional: true;
            };
            readonly provider: {
                readonly about: "模型供应方";
                readonly optional: true;
            };
            readonly model: {
                readonly about: "模型";
                readonly optional: true;
            };
            readonly reasoningEffort: {
                readonly about: "思考档位";
                readonly optional: true;
            };
            readonly agentPreset: {
                readonly about: "代理预设";
                readonly optional: true;
            };
            readonly permission: {
                readonly about: "权限预设，只能填目录里存在的键";
                readonly optional: true;
            };
            readonly color: {
                readonly about: "卡片强调色";
                readonly optional: true;
            };
        };
    };
    readonly 'task.move': {
        readonly verb: "move";
        readonly domain: "board";
        readonly lane: "document";
        readonly danger: "guarded";
        readonly surface: "ui+ai";
        readonly summary: "把卡移到另一栏。移到「已完成」会同时解甲排期与全部会话规则；这一栏真有轮次在跑时移动被拒。";
        readonly semantic: true;
        readonly semanticOf: "moveTaskToStatus";
        readonly params: {
            readonly of: {
                readonly about: "要移动的卡";
            };
            readonly status: {
                readonly about: "目标栏";
                readonly oneOf: readonly string[];
            };
            readonly beforeId: {
                readonly about: "插到同栏这张卡之前";
                readonly optional: true;
                readonly appliesWhen: "只在同一栏内排序时需要";
            };
        };
    };
    readonly 'task.approve': {
        readonly verb: "move";
        readonly domain: "board";
        readonly lane: "document";
        readonly danger: "guarded";
        readonly surface: "ui+ai";
        readonly summary: "通过一张待审核的卡：一次动作做两件事——把已读钟推到此刻，并把它移到「已完成」（动词是 move，但读状态也一起变了，所以别拿它当纯移栏用）。真有轮次还在跑时整条拒绝，状态与已读都不动；这时候该做的是等这次运行结算完再来，而不是换个动作绕过去。";
        readonly semantic: true;
        readonly semanticOf: "moveTaskToStatus";
        readonly params: {
            readonly of: {
                readonly about: "要通过的卡";
            };
        };
    };
    readonly 'task.delete': {
        readonly verb: "delete";
        readonly domain: "board";
        readonly lane: "document";
        readonly danger: "irreversible";
        readonly surface: "ui+ai";
        readonly summary: "删一张卡。不可恢复（清单条目的删除走墓碑能找回，卡片不行），做之前先给用户看清单。";
        readonly params: {
            readonly of: {
                readonly about: "要删的卡";
            };
        };
    };
    readonly 'task.schedule': {
        readonly verb: "automate";
        readonly domain: "board";
        readonly lane: "document";
        readonly danger: "guarded";
        readonly surface: "ui+ai";
        readonly summary: "给卡上/解排期。给没有执行 Prompt 的卡上膛会被拒（规则永远跑不起来，开关却显示已开）。";
        readonly semantic: true;
        readonly semanticOf: "armSchedule";
        readonly params: {
            readonly of: {
                readonly about: "要排期的卡";
            };
            readonly enabled: {
                readonly about: "上膛还是解甲";
                readonly optional: true;
                readonly boolean: true;
                readonly default: "不传 = 沿用这张卡现在的上膛状态；卡上还没有规则时不传等于关";
            };
            readonly mode: {
                readonly about: "cron 定时 / chain 完成后接续";
                readonly optional: true;
                readonly oneOf: readonly ["cron", "chain"];
                readonly default: "不传 = cron";
            };
            readonly cron: {
                readonly about: "五段 cron 表达式";
                readonly requiredWhen: "mode 是 cron（mode 不传时有效值就是 cron）；解甲不必给";
            };
            readonly maxRuns: {
                readonly about: "最多跑几次";
                readonly optional: true;
                readonly appliesWhen: "留空 = 不限次";
            };
        };
    };
    readonly 'task.run': {
        readonly verb: "run";
        readonly domain: "board";
        readonly lane: "engine";
        readonly danger: "guarded";
        readonly surface: "ui+ai";
        readonly relay: "run";
        readonly summary: "立刻跑一次这张卡。会真开会话、真花 token；没有浏览器持席位时只能排队，引擎上线才补发。";
        readonly params: {
            readonly of: {
                readonly about: "要跑的卡";
            };
            readonly trigger: {
                readonly about: "触发来源（只影响归因，不影响执行）";
                readonly optional: true;
                readonly oneOf: readonly ["manual", "schedule", "chain"];
            };
        };
    };
    readonly 'task.comment': {
        readonly verb: "speak";
        readonly domain: "board";
        readonly lane: "engine";
        readonly danger: "guarded";
        readonly surface: "ui+ai";
        readonly relay: "comment";
        readonly summary: "对某个会话说一句话，接着上次的对话继续。它骑的是**发言**那条载波，不是 run 载波——**走 run 中继只会白跑一次卡，那句话一个字也发不出去**。排队还是插话由用户的开关定，不接受指定。";
        readonly params: {
            readonly of: {
                readonly about: "目标卡";
            };
            readonly session: {
                readonly about: "目标会话";
                readonly requiredWhen: "这张卡挂了不止一个会话时必须指明";
            };
            readonly text: {
                readonly about: "要发的话";
            };
            readonly command: {
                readonly about: "这是一条斜杠命令而不是一句话";
                readonly optional: true;
                readonly boolean: true;
            };
        };
    };
    readonly 'task.cancelComment': {
        readonly verb: "delete";
        readonly domain: "board";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui+ai";
        readonly summary: "撤掉一条还在排队的评论轮次（已经注入出去的那条撤不回来）。";
        readonly params: {
            readonly round: {
                readonly about: "要撤的轮次";
            };
        };
    };
    readonly 'task.ack': {
        readonly verb: "ack";
        readonly domain: "board";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui";
        readonly summary: "已读钟。属于人：模型替人标已读会直接消掉「待你决断」那道门，所以工具不提供它。";
        readonly params: {
            readonly of: {
                readonly about: "要标已读的卡";
                readonly requiredWhen: "scope 不是 all";
            };
            readonly scope: {
                readonly about: "标到哪一层";
                readonly optional: true;
                readonly oneOf: readonly ["task", "session", "round", "all"];
                readonly default: "不传 = 整张卡（等价于 markAllViewed 那一路）";
            };
            readonly session: {
                readonly about: "会话轮";
                readonly requiredWhen: "scope 是 session";
            };
            readonly round: {
                readonly about: "轮次";
                readonly requiredWhen: "scope 是 round";
            };
        };
    };
    readonly 'task.navigate': {
        readonly verb: "navigate";
        readonly domain: "board";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui";
        readonly summary: "打开一张卡的详情。";
        readonly params: {
            readonly of: {
                readonly about: "要打开的卡";
            };
        };
    };
    readonly 'board.cruise': {
        readonly verb: "cruise";
        readonly domain: "board";
        readonly lane: "document";
        readonly danger: "guarded";
        readonly surface: "ui+ai";
        readonly summary: "巡航总开关与并发上限。巡航关着时排队的评论不会注入——这时发消息等于什么都没发生，所以如实说清。";
        readonly params: {
            readonly enabled: {
                readonly about: "开还是关";
                readonly optional: true;
                readonly boolean: true;
                readonly default: "不传 = 保持现在的开关状态";
            };
            readonly limit: {
                readonly about: "同时跑几条";
                readonly optional: true;
                readonly range: {
                    readonly min: 1;
                    readonly max: 20;
                };
                readonly default: "不传 = 保持现在的上限；超出 1..20 会被夹到边界";
            };
        };
    };
    readonly 'board.navigate': {
        readonly verb: "navigate";
        readonly domain: "board";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui";
        readonly summary: "在看板与会话之间切换舞台。";
        readonly params: {
            readonly target: {
                readonly about: "要去哪";
                readonly optional: true;
                readonly oneOf: readonly ["board", "conversation"];
            };
        };
    };
    readonly 'rule.create': {
        readonly verb: "automate";
        readonly domain: "session";
        readonly lane: "document";
        readonly danger: "guarded";
        readonly surface: "ui+ai";
        readonly summary: "给卡上的某个会话建一条自动化规则。一张卡对同一个会话只允许一条（要改就改它，不叠触发）。";
        readonly params: {
            readonly of: {
                readonly about: "目标卡";
            };
            readonly session: {
                readonly about: "要被自动化的会话";
            };
            readonly trigger: {
                readonly about: "cron 定时 / on-complete 每次跑完";
                readonly optional: true;
                readonly oneOf: readonly ["cron", "on-complete"];
                readonly default: "不传 = cron";
            };
            readonly cron: {
                readonly about: "五段 cron 表达式";
                readonly requiredWhen: "trigger 是 cron（trigger 不传时有效值就是 cron，所以照样要给）";
            };
            readonly usePrompt: {
                readonly about: "送这张卡当前的执行 Prompt，而不是自定义文本";
                readonly optional: true;
                readonly boolean: true;
                readonly default: "不传 = 送自定义文本（也就是要一起给 instruction）";
            };
            readonly instruction: {
                readonly about: "要定时送出去的话";
                readonly requiredWhen: "usePrompt 是 false（usePrompt 不传时有效值就是 false，所以照样要给）";
            };
            readonly send: {
                readonly about: "排队还是插话";
                readonly oneOf: readonly ["queue", "steer"];
            };
        };
    };
    readonly 'rule.update': {
        readonly verb: "automate";
        readonly domain: "session";
        readonly lane: "document";
        readonly danger: "guarded";
        readonly surface: "ui+ai";
        readonly summary: "改一条已有规则的内容、触发方式、发送方式或开关。目标会话不可改：界面上这个下拉是锁死的，一个会话的自动化只有一条定义，工具不能偷偷换目标。";
        readonly params: {
            readonly of: {
                readonly about: "目标卡";
            };
            readonly rule: {
                readonly about: "要改的规则";
            };
            readonly enabled: {
                readonly about: "上膛还是解甲";
                readonly optional: true;
                readonly boolean: true;
                readonly default: "不传 = 这次不动它的上膛状态";
            };
            readonly trigger: {
                readonly about: "cron 定时 / on-complete 每次跑完";
                readonly optional: true;
                readonly oneOf: readonly ["cron", "on-complete"];
                readonly default: "不传 = 沿用这条规则现在的触发方式";
            };
            readonly cron: {
                readonly about: "五段 cron 表达式";
                readonly requiredWhen: "trigger 是 cron（trigger 不传时有效值沿用当前，当前是 cron 就仍然要给）";
            };
            readonly usePrompt: {
                readonly about: "送执行 Prompt 而不是自定义文本";
                readonly optional: true;
                readonly boolean: true;
                readonly default: "不传 = 送自定义文本（也就是要一起给 instruction）";
            };
            readonly instruction: {
                readonly about: "要定时送出去的话";
                readonly requiredWhen: "usePrompt 是 false（usePrompt 不传时有效值就是 false）";
            };
            readonly send: {
                readonly about: "排队还是插话";
                readonly optional: true;
                readonly oneOf: readonly ["queue", "steer"];
            };
        };
    };
    readonly 'rule.delete': {
        readonly verb: "delete";
        readonly domain: "session";
        readonly lane: "document";
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
        readonly danger: "guarded";
        readonly surface: "ui+ai";
        readonly summary: "删掉一条会话自动化规则。";
        readonly params: {
            readonly of: {
                readonly about: "目标卡";
            };
            readonly rule: {
                readonly about: "要删的规则";
            };
        };
    };
    readonly 'session.create': {
        readonly verb: "create";
        readonly domain: "session";
        readonly lane: "engine";
        readonly danger: "guarded";
        readonly surface: "ui+ai";
        readonly relay: "session.create";
        readonly summary: "按给定的运行配置建一条新的原生会话，**并且同时把它挂到这张卡上**——所以这条既是 create 也是 bind，不给 of 就没法用（要挂来源但不想建会话，去 session.bind）。它骑的是**建会话**那条载波，不是 run 载波——**走 run 中继同样只会白跑一次卡，会话不会被建出来**。卡本身不动：不产生执行记录、不进派发队列、不碰任何自动化。会话是原生侧真实存在的东西，绑定可以摘掉，关掉它要用户自己在原生界面做。会话创建在宿主缺席时直接失败，不会假装排队。";
        readonly params: {
            readonly of: {
                readonly about: "要挂到哪张卡上";
            };
            readonly title: {
                readonly about: "会话名";
                readonly optional: true;
                readonly appliesWhen: "留空 = 一个字都不发，会话由宿主自己的命名链在第一句真话之后命名；给了名字就用官方改名接口钉住它，宿主之后不会再自动改名";
            };
            readonly workspaceId: {
                readonly about: "跑在哪台机器上";
                readonly optional: true;
                readonly appliesWhen: "留空 = 不指定，由宿主按自己的默认链解析";
            };
            readonly provider: {
                readonly about: "模型供应方";
                readonly optional: true;
                readonly appliesWhen: "留空 = 不指定，由宿主按自己的默认链解析";
            };
            readonly model: {
                readonly about: "模型";
                readonly optional: true;
                readonly appliesWhen: "留空 = 不指定，由宿主按自己的默认链解析";
            };
            readonly reasoningEffort: {
                readonly about: "思考档位";
                readonly optional: true;
                readonly appliesWhen: "留空 = 不指定，由宿主按自己的默认链解析";
            };
            readonly agentPreset: {
                readonly about: "代理预设";
                readonly optional: true;
                readonly appliesWhen: "留空 = 不指定，由宿主按自己的默认链解析";
            };
            readonly permission: {
                readonly about: "权限预设，只能填目录里真实存在的键";
                readonly optional: true;
                readonly appliesWhen: "留空 = 不指定，由宿主按自己的默认链解析";
            };
        };
    };
    readonly 'session.bind': {
        readonly verb: "bind";
        readonly domain: "session";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui+ai";
        readonly summary: "给卡挂一个来源：一个会话，或一个整个工作区。一次加一个（两个参数二选一，不是都填）。";
        readonly params: {
            readonly of: {
                readonly about: "目标卡";
            };
            readonly session: {
                readonly about: "要挂的会话";
                readonly requiredWhen: "没给 workspace 时必填（与 workspace 二选一）";
            };
            readonly workspace: {
                readonly about: "要挂的工作区";
                readonly requiredWhen: "没给 session 时必填（与 session 二选一）";
            };
        };
    };
    readonly 'session.remove': {
        readonly verb: "delete";
        readonly domain: "session";
        readonly lane: "document";
        readonly danger: "guarded";
        readonly surface: "ui+ai";
        readonly summary: "把一个会话从卡上永久摘掉（连它的轮次一起）。这是删除，不是隐藏。";
        readonly semantic: true;
        readonly semanticOf: "removeSessionFromTask";
        readonly params: {
            readonly of: {
                readonly about: "目标卡";
            };
            readonly session: {
                readonly about: "要摘掉的会话";
            };
        };
    };
    readonly 'session.rename': {
        readonly verb: "update";
        readonly domain: "session";
        readonly lane: "engine";
        readonly danger: "guarded";
        readonly surface: "ui+ai";
        readonly relay: "session.rename";
        readonly summary: "给一个会话改它的显示名——改的是**原生侧那条会话**的名字，不是插件里这张卡的标题（卡标题走 task.update 的 title）。**不用先知道是哪张卡**：这条动作的目标就是那条会话，而它会不会出现在某张卡上由那张卡的 binds 决定，与改名无关（为改个名字先去查一遍卡，是凭空多一轮）。动词是 update，宾语却在插件之外。它骑的是**改名**那条载波，不是 run 载波——**改名字不触发任何执行，走 run 中继同样只会白跑一次卡，名字不会改**。";
        readonly params: {
            readonly session: {
                readonly about: "要改名的会话（会话 id）";
            };
            readonly title: {
                readonly about: "新名字";
            };
        };
    };
    readonly 'session.reorder': {
        readonly verb: "update";
        readonly domain: "session";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui+ai";
        readonly summary: "调整卡上会话列表的显示顺序（只改顺序，一个字段都不改）。";
        readonly params: {
            readonly of: {
                readonly about: "目标卡";
            };
            readonly session: {
                readonly about: "要移动的会话";
            };
            readonly beforeId: {
                readonly about: "插到这个会话前面";
                readonly optional: true;
                readonly appliesWhen: "只在列表内排序时需要";
            };
        };
    };
    readonly 'session.hide': {
        readonly verb: "update";
        readonly domain: "session";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui";
        readonly summary: "把某几行收进隐藏格（可一键恢复，不是删除）。纯显示选择，工具不代劳。";
        readonly params: {
            readonly of: {
                readonly about: "目标卡";
            };
            readonly scope: {
                readonly about: "动的是哪一行";
                readonly oneOf: readonly ["session", "round"];
            };
            readonly session: {
                readonly about: "要收起的会话";
                readonly requiredWhen: "scope 是 session";
            };
            readonly round: {
                readonly about: "要收起的轮次";
                readonly requiredWhen: "scope 是 round";
            };
            readonly hidden: {
                readonly about: "收起还是恢复";
                readonly boolean: true;
            };
        };
    };
    readonly 'session.navigate': {
        readonly verb: "navigate";
        readonly domain: "session";
        readonly lane: "engine";
        readonly danger: "reversible";
        readonly surface: "ui";
        readonly summary: "打开一个会话。";
        readonly params: {
            readonly session: {
                readonly about: "要打开的会话";
            };
        };
    };
    readonly 'preset.create': {
        readonly verb: "create";
        readonly domain: "preset";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui+ai";
        readonly summary: "存一条自己的预设：一条排期预设（名字 + cron）或一条运行配置预设（名字 + 若干运行字段）。";
        readonly params: {
            readonly kind: {
                readonly about: "哪一种预设";
                readonly oneOf: readonly ["schedule", "run"];
            };
            readonly label: {
                readonly about: "预设名";
            };
            readonly cron: {
                readonly about: "五段 cron 表达式";
                readonly requiredWhen: "kind 是 schedule";
            };
            readonly config: {
                readonly about: "运行配置（只给要钉住的那几项，其余走默认）";
                readonly requiredWhen: "kind 是 run";
                readonly object: readonly ["workspaceId", "provider", "model", "reasoningEffort", "agentPreset", "permission"];
            };
        };
    };
    readonly 'preset.update': {
        readonly verb: "update";
        readonly domain: "preset";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui+ai";
        readonly summary: "改一条自己的预设，或把它设成默认（只有运行配置预设有默认这回事）。";
        readonly params: {
            readonly of: {
                readonly about: "要改的预设";
            };
            readonly label: {
                readonly about: "新名字";
                readonly optional: true;
            };
            readonly cron: {
                readonly about: "新的五段 cron 表达式";
                readonly optional: true;
                readonly appliesWhen: "只对排期预设";
            };
            readonly config: {
                readonly about: "新的运行配置（只给要改的那几项）";
                readonly optional: true;
                readonly appliesWhen: "只对运行配置预设";
                readonly object: readonly ["workspaceId", "provider", "model", "reasoningEffort", "agentPreset", "permission"];
            };
            readonly makeDefault: {
                readonly about: "设为默认 / 取消默认";
                readonly optional: true;
                readonly boolean: true;
                readonly appliesWhen: "只对运行配置预设";
            };
        };
    };
    readonly 'preset.delete': {
        readonly verb: "delete";
        readonly domain: "preset";
        readonly lane: "document";
        /** `guarded` for the same reason as `rule.delete`, and with more behind it:
         *  `persist` OVERWRITES the whole section, so this is the end of a name and
         *  up to six configuration fields the reader typed, on every device at once.
         *  「恢复默认」 next to it in the same dialog is `reversible` in the strict
         *  sense — it re-adds the built-ins that were never deleted — and that is
         *  exactly the sort of difference this field exists to say out loud. */
        readonly danger: "guarded";
        readonly surface: "ui+ai";
        readonly summary: "删掉一条自己的预设（内置的那批删不掉，也不用删）。";
        readonly params: {
            readonly of: {
                readonly about: "要删的预设";
            };
        };
    };
    readonly 'item.create': {
        readonly verb: "create";
        readonly domain: "item";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui+ai";
        readonly semantic: true;
        readonly semanticOf: "captureItemRecord";
        readonly summary: "记一条清单条目。标题可以留空（会从正文首行补），步骤只有一层、进度自动算。";
        readonly params: {
            readonly body: {
                readonly about: "正文，Markdown";
            };
            readonly title: {
                readonly about: "一行标题";
                readonly optional: true;
            };
            readonly notes: {
                readonly about: "给接手的人或模型看的上下文备注";
                readonly optional: true;
            };
            readonly steps: {
                readonly about: "勾选清单（只有一层）";
                readonly optional: true;
                readonly list: {
                    readonly about: "一步：text 是那行字，done 是勾没勾；id 由文档分配，不要自己编";
                    readonly object: readonly ["text", "done"];
                };
            };
            readonly status: {
                readonly about: "开放 / 受阻 / 完成";
                readonly optional: true;
                readonly oneOf: readonly string[];
            };
            readonly priority: {
                readonly about: "四档优先级";
                readonly optional: true;
                readonly oneOf: readonly string[];
            };
            readonly tags: {
                readonly about: "自由标签";
                readonly optional: true;
                readonly list: "string";
            };
            readonly startsAfter: {
                readonly about: "最早开始";
                readonly optional: true;
                readonly default: "毫秒时间戳，但它标的是一「天」：给本地零点，别给「现在」。界面日期框交出来的就是本地零点，读取也按本地整天边界判断，所以 UTC 正午会在界面上显示成前一天。";
            };
            readonly dueAt: {
                readonly about: "截止";
                readonly optional: true;
                readonly default: "毫秒时间戳，但它标的是一「天」：给本地零点，别给「现在」。界面日期框交出来的就是本地零点，读取也按本地整天边界判断，所以 UTC 正午会在界面上显示成前一天。";
            };
            readonly hardDueAt: {
                readonly about: "硬期限";
                readonly optional: true;
                readonly default: "毫秒时间戳，但它标的是一「天」：给本地零点，别给「现在」。界面日期框交出来的就是本地零点，读取也按本地整天边界判断，所以 UTC 正午会在界面上显示成前一天。";
            };
            readonly taskId: {
                readonly about: "关联的看板卡片（零张或一张）";
                readonly optional: true;
            };
        };
    };
    readonly 'item.update': {
        readonly verb: "update";
        readonly domain: "item";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui+ai";
        readonly semantic: true;
        readonly semanticOf: "applyItemPatch";
        readonly summary: "改一条清单条目（用 #编号 指它）。只改传了的字段；编号与来源不可写。";
        readonly params: {
            readonly of: {
                readonly about: "要改的条目编号：填那个数字本身（12），不要带 # 号——# 只是它显示时的样子";
            };
            readonly title: {
                readonly about: "一行标题";
                readonly optional: true;
            };
            readonly body: {
                readonly about: "正文，Markdown";
                readonly optional: true;
            };
            readonly notes: {
                readonly about: "上下文备注";
                readonly optional: true;
            };
            readonly steps: {
                readonly about: "勾选清单（整份替换，只有一层）";
                readonly optional: true;
                readonly list: {
                    readonly about: "一步：text 是那行字，done 是勾没勾；id 由文档分配，不要自己编";
                    readonly object: readonly ["text", "done"];
                };
            };
            readonly status: {
                readonly about: "开放 / 受阻 / 完成（「进行中」是派生的，不可写）";
                readonly optional: true;
                readonly oneOf: readonly string[];
            };
            readonly priority: {
                readonly about: "四档优先级";
                readonly optional: true;
                readonly oneOf: readonly string[];
            };
            readonly tags: {
                readonly about: "自由标签（整份替换）";
                readonly optional: true;
                readonly list: "string";
            };
            readonly startsAfter: {
                readonly about: "最早开始";
                readonly optional: true;
                readonly default: "毫秒时间戳，但它标的是一「天」：给本地零点，别给「现在」。界面日期框交出来的就是本地零点，读取也按本地整天边界判断，所以 UTC 正午会在界面上显示成前一天。";
            };
            readonly dueAt: {
                readonly about: "截止";
                readonly optional: true;
                readonly default: "毫秒时间戳，但它标的是一「天」：给本地零点，别给「现在」。界面日期框交出来的就是本地零点，读取也按本地整天边界判断，所以 UTC 正午会在界面上显示成前一天。";
            };
            readonly hardDueAt: {
                readonly about: "硬期限";
                readonly optional: true;
                readonly default: "毫秒时间戳，但它标的是一「天」：给本地零点，别给「现在」。界面日期框交出来的就是本地零点，读取也按本地整天边界判断，所以 UTC 正午会在界面上显示成前一天。";
            };
            readonly taskId: {
                readonly about: "关联的看板卡片";
                readonly optional: true;
            };
        };
    };
    readonly 'item.delete': {
        readonly verb: "delete";
        readonly domain: "item";
        readonly lane: "document";
        readonly danger: "guarded";
        readonly surface: "ui+ai";
        readonly semantic: true;
        readonly semanticOf: "removeItemRecord";
        readonly summary: "删一条清单条目。走墓碑，所以能恢复；但没有撤销层，删之前值得先说一句。";
        readonly params: {
            readonly of: {
                readonly about: "要删的条目编号：填那个数字本身（12），不要带 # 号";
            };
        };
    };
    readonly 'item.step': {
        readonly verb: "update";
        readonly domain: "item";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui+ai";
        readonly semantic: true;
        readonly semanticOf: "applyItemStep";
        readonly summary: "勾掉或取消勾选某一条里的某一步。只动那一步，别的步骤和别的字段都不碰。";
        readonly params: {
            readonly of: {
                readonly about: "条目编号：填那个数字本身（12），不要带 # 号";
            };
            readonly step: {
                readonly about: "那一步的 id。它是清单里那一行勾选框的身份，先查一次拿到它";
            };
            readonly done: {
                readonly about: "true 勾上，false 取消勾上";
                readonly boolean: true;
            };
        };
    };
    readonly 'item.promote': {
        readonly verb: "create";
        readonly domain: "item";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui+ai";
        readonly semantic: true;
        readonly semanticOf: "planItemPromotion";
        readonly summary: "把一条清单条目变成一张看板卡片，并把两边互相链接。清单这一条不消失——它已经是那张卡的来处，链接上了以后它会带着卡一起显示。";
        readonly params: {
            readonly of: {
                readonly about: "要提升的条目编号：填那个数字本身（12），不要带 # 号";
            };
            readonly cardTitle: {
                readonly about: "给新卡换个标题；不填就用清单这一条的标题";
                readonly optional: true;
            };
            readonly cardPrompt: {
                readonly about: "给新卡的执行 Prompt（卡真正跑起来送出去的那段）；不填就用清单这一条的正文";
                readonly optional: true;
            };
        };
    };
    readonly 'item.restore': {
        readonly verb: "restore";
        readonly domain: "item";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui+ai";
        readonly semantic: true;
        readonly semanticOf: "restoredItemOf";
        readonly summary: "把一条删掉的清单条目找回来。删除走的是墓碑，条目本身还在，所以是原样回来，不是重建一条新的。";
        readonly params: {
            readonly of: {
                readonly about: "要恢复的条目编号：填那个数字本身（12），不要带 # 号";
            };
        };
    };
    readonly 'item.purge': {
        readonly verb: "delete";
        readonly domain: "item";
        readonly lane: "document";
        readonly danger: "irreversible";
        readonly surface: "ui+ai";
        readonly semantic: true;
        readonly semanticOf: "purgeItemTombstone";
        readonly summary: "把一条已删除的清单条目彻底清掉：连墓碑里留着的正文一起扔掉，撤不回来。只想让它从清单里消失就用删除（那个还能找回）。对着还没删过的条目用这一条会被拒。";
        readonly params: {
            readonly of: {
                readonly about: "要清掉的条目编号：填那个数字本身（12），不要带 # 号";
            };
        };
    };
    readonly 'item.navigate': {
        readonly verb: "navigate";
        readonly domain: "item";
        readonly lane: "document";
        readonly danger: "reversible";
        readonly surface: "ui";
        readonly summary: "把清单面板切到某个页面，或者聚焦到某一条。只有界面能调：模型不替人翻界面。";
        readonly params: {
            readonly page: {
                readonly about: "要去哪个页面";
                readonly optional: true;
                readonly oneOf: readonly ["inbox", "list", "schedule"];
                readonly default: "不传 = 留在当前页，只聚焦某一条";
            };
            readonly of: {
                readonly about: "要聚焦的条目编号：填那个数字本身（12），不要带 # 号";
                readonly optional: true;
            };
        };
    };
};
/** Every action the catalog declares. The closed union every other type keys on. */
export type ActionId = keyof typeof ACTIONS;
/** The checklist's actions, DERIVED from {@link ActionId} rather than listed. */
export type ItemActionId = Extract<ActionId, `item.${string}`>;
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
export declare const NOT_YET_BUILT: Partial<Record<ActionId, string>>;
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
export declare const ITEM_HANDLERS: {
    readonly 'item.create': typeof itemTransitions.captureItemRecord;
    readonly 'item.update': typeof itemTransitions.applyItemPatch;
    readonly 'item.delete': typeof itemTransitions.removeItemRecord;
    readonly 'item.step': typeof itemTransitions.applyItemStep;
    readonly 'item.promote': typeof itemTransitions.planItemPromotion;
    readonly 'item.restore': typeof itemsDocument.restoredItemOf;
    readonly 'item.purge': typeof itemsDocument.purgeItemTombstone;
};
/**
 * {@link ITEM_HANDLERS} by NAME, read off the table itself rather than written
 * out beside it.
 *
 * The same argument as {@link SEMANTIC_FUNCTIONS}: a second list of names is a
 * thing to keep in step with the code, and the day it stops agreeing nothing says
 * so. Read off the table, a rename moves both at once and a binding that was
 * deleted stops vouching for itself the same moment.
 */
export declare const ITEM_HANDLER_NAMES: Record<string, string>;
/** The verbs, as data — the coverage gate and any renderer read this, never a
 *  second hand-written list. `query` is the read lane's verb and has no action
 *  here on purpose: a query is not a change, and its shape comes from the
 *  qualifier registry, not from a row in this table. */
export declare const BOARD_VERBS: readonly BoardVerb[];
/**
 * The ops the TOOL may offer: everything the model can reach. This is the one
 * place rule 2 is decided, so nothing has to remember it (a second list would
 * be the drift this file exists to prevent).
 */
export declare const TOOL_ACTION_IDS: readonly ActionId[];
/**
 * The envelope around a batch of ops — NOT per-action parameters, because it
 * describes the call and not the action. `dry_run` is always optional and is
 * the same for every op: a whole batch rehearsed on a clone, not one op at a
 * time (an op at a time would be a second undo stack, and the merge grammar
 * has no room for one).
 */
export declare const EXECUTE_ENVELOPE_PARAMS: Readonly<Record<string, ParamSpec>>;
/** The inputs a catalog check runs against. All optional: with none supplied
 *  it checks the real catalog against the real verdicts. */
export interface CatalogChecks {
    /** The action table to check. */
    readonly actions?: Readonly<Record<string, ActionShape>>;
    /** The shared pure functions that actually exist, keyed by name. A `semantic`
     *  action naming anything outside it is a finding. */
    readonly semantic?: Readonly<Record<string, true>>;
    /** The task patch's field verdicts. */
    readonly taskFields?: Readonly<Record<string, FieldSpec>>;
    /** The checklist row's field verdicts. */
    readonly itemFields?: Readonly<Record<string, FieldSpec>>;
    /**
     * Which core function each checklist action binds to, keyed by action id. The
     * real table is {@link ITEM_HANDLERS}.
     *
     * Injectable for the same reason as everything else here: a check that has only
     * ever passed against the real table is indistinguishable from a check that
     * cannot fail, so the tests feed it a deliberately broken copy and assert each
     * new rule bites.
     */
    readonly itemHandlers?: Readonly<Record<string, string>>;
    /** The "described but not bound" ledger. The real one is {@link NOT_YET_BUILT}. */
    readonly notYetBuilt?: Readonly<Record<string, string>>;
}
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
export declare function actionCatalogFindings(checks?: CatalogChecks): string[];
