import type { TaskUpdatePatch } from './controller.ts';
import { type FieldSpec } from './item.ts';
export type { FieldSpec };
/** The twelve verbs. The table is a CONTRACT: a thirteenth verb is a decision,
 *  not a convenience, and the catalog is written to fit inside these. */
export type BoardVerb = 'create' | 'update' | 'move' | 'delete' | 'run' | 'speak' | 'bind' | 'automate' | 'cruise' | 'ack' | 'navigate' | 'query';
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
    /** A closed set, when there is one. Keeps a renderer from inventing values. */
    readonly oneOf?: readonly string[];
    readonly optional?: true;
    /** Required only under this condition — stated, never left to be inferred. */
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
    /** One of the twelve. */
    readonly verb: BoardVerb;
    readonly domain: ActionDomain;
    readonly lane: ActionLane;
    readonly danger: ActionDanger;
    /** One sentence, for the model: what this action DOES (not how to spell it). */
    readonly summary: string;
    readonly params: Readonly<Record<string, ParamSpec>>;
    readonly surface: ActionSurface;
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
 * the twelve. `domain` says which document the action speaks about, which is
 * not always the subject: a rule belongs to the session domain, a cruise
 * switch to the board's.
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
                readonly about: "建卡时直接挂上的会话或工作区（可多项）";
                readonly optional: true;
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
        readonly summary: "通过一张待审核的卡：标已读并移到「已完成」。有轮次在跑时拒绝，状态原样不动。";
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
            };
            readonly mode: {
                readonly about: "cron 定时 / chain 完成后接续";
                readonly optional: true;
                readonly oneOf: readonly ["cron", "chain"];
            };
            readonly cron: {
                readonly about: "五段 cron 表达式";
                readonly requiredWhen: "mode 是 cron（上膛时必填；解甲不必给）";
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
        readonly summary: "对这张卡的某个会话发一条消息，接着上次的对话继续。排队还是插话由用户的开关定，不接受指定。";
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
                readonly oneOf: readonly ["true", "false"];
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
                readonly oneOf: readonly ["task", "session", "round"];
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
            };
            readonly limit: {
                readonly about: "同时跑几条（1..20）";
                readonly optional: true;
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
            };
            readonly cron: {
                readonly about: "五段 cron 表达式";
                readonly requiredWhen: "trigger 是 cron";
            };
            readonly usePrompt: {
                readonly about: "送这张卡当前的执行 Prompt，而不是自定义文本";
                readonly optional: true;
                readonly oneOf: readonly ["true", "false"];
            };
            readonly instruction: {
                readonly about: "要定时送出去的话";
                readonly requiredWhen: "usePrompt 是 false";
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
            };
            readonly trigger: {
                readonly about: "cron 定时 / on-complete 每次跑完";
                readonly optional: true;
                readonly oneOf: readonly ["cron", "on-complete"];
            };
            readonly cron: {
                readonly about: "五段 cron 表达式";
                readonly requiredWhen: "trigger 是 cron";
            };
            readonly usePrompt: {
                readonly about: "送执行 Prompt 而不是自定义文本";
                readonly optional: true;
                readonly oneOf: readonly ["true", "false"];
            };
            readonly instruction: {
                readonly about: "要定时送出去的话";
                readonly requiredWhen: "usePrompt 是 false";
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
        readonly danger: "reversible";
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
        readonly summary: "按给定的运行配置建一条新的原生会话，并挂到这张卡上——这正是「开一个新 session 让它调用任务看板」要做的事。卡本身不动：不产生执行记录、不进派发队列、不碰任何自动化。会话是原生侧真实存在的东西，绑定可以摘掉，关掉它要用户自己在原生界面做。会话创建在宿主缺席时直接失败，不会假装排队。";
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
        readonly summary: "给卡挂一个来源：一个会话，或一个整个工作区。一次加一个。";
        readonly params: {
            readonly of: {
                readonly about: "目标卡";
            };
            readonly session: {
                readonly about: "要挂的会话";
                readonly requiredWhen: "没给 workspace 时必填";
            };
            readonly workspace: {
                readonly about: "要挂的工作区";
                readonly requiredWhen: "没给 session 时必填";
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
        readonly summary: "给这个会话改个显示用的名字。";
        readonly params: {
            readonly of: {
                readonly about: "目标卡";
            };
            readonly session: {
                readonly about: "要改名的会话";
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
        readonly summary: "调整卡上会话列表的顺序。";
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
            readonly session: {
                readonly about: "要收起的会话";
                readonly requiredWhen: "动的是会话行";
            };
            readonly round: {
                readonly about: "要收起的轮次";
                readonly requiredWhen: "动的是轮次行";
            };
            readonly hidden: {
                readonly about: "收起还是恢复";
                readonly oneOf: readonly ["true", "false"];
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
                readonly about: "运行配置（模型 / 思考档 / 权限预设…）";
                readonly requiredWhen: "kind 是 run";
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
                readonly about: "新的运行配置";
                readonly optional: true;
                readonly appliesWhen: "只对运行配置预设";
            };
            readonly makeDefault: {
                readonly about: "设为默认 / 取消默认";
                readonly optional: true;
                readonly oneOf: readonly ["true", "false"];
                readonly appliesWhen: "只对运行配置预设";
            };
        };
    };
    readonly 'preset.delete': {
        readonly verb: "delete";
        readonly domain: "preset";
        readonly lane: "document";
        readonly danger: "reversible";
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
            };
            readonly startsAfter: {
                readonly about: "最早开始（毫秒时间戳）";
                readonly optional: true;
            };
            readonly dueAt: {
                readonly about: "截止（毫秒时间戳）";
                readonly optional: true;
            };
            readonly hardDueAt: {
                readonly about: "硬期限（毫秒时间戳）";
                readonly optional: true;
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
        readonly summary: "改一条清单条目（用 #编号 指它）。只改传了的字段；编号与来源不可写。";
        readonly params: {
            readonly of: {
                readonly about: "要改的条目编号（#12 那个号）";
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
            };
            readonly startsAfter: {
                readonly about: "最早开始";
                readonly optional: true;
            };
            readonly dueAt: {
                readonly about: "截止";
                readonly optional: true;
            };
            readonly hardDueAt: {
                readonly about: "硬期限";
                readonly optional: true;
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
        readonly summary: "删一条清单条目。走墓碑，所以能恢复；但没有撤销层，删之前值得先说一句。";
        readonly params: {
            readonly of: {
                readonly about: "要删的条目编号";
            };
        };
    };
};
/** Every action the catalog declares. The closed union every other type keys on. */
export type ActionId = keyof typeof ACTIONS;
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
