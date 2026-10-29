/** One image attached to a message — the DURABLE ref form the host stores
 *  after admission (the browser submitted temporary bytes; the stored event
 *  carries the promoted reference). Renderers fetch the bytes through the
 *  official `sessions.attachment` read. */
export interface TranscriptImage {
    attachmentId: string;
    mediaType: string;
    name?: string;
}
/** Token accounting of one assistant message (native `usage` payload). */
export interface TranscriptUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
}
/** One process step inside a turn. */
export type TranscriptStep = 
/** 一次工具调用；`state` 由 `tool/call` 与 `tool/result` 配对推出。 */
{
    kind: 'tool';
    id: string;
    name: string;
    state: 'running' | 'settled' | 'unsettled';
    step: number;
}
/** 一段思考：只留字数与首行（正文太长，折行里放不下也不该占内存）。 */
 | {
    kind: 'reasoning';
    id: string;
    chars: number;
    preview: string;
    step: number;
}
/** 一次上下文注入（技能、指令文件、会话引用、定时通知…）。 */
 | {
    kind: 'context';
    id: string;
    producer: string;
    summary: string;
    at: number;
};
/** One assistant reply inside a turn. */
export interface TranscriptReply {
    id: string;
    text: string;
    images?: TranscriptImage[];
    at: number;
    usage?: TranscriptUsage;
}
/** One turn: what the reader said, what happened, what came out. */
export interface TranscriptTurn {
    /** 宿主给这一轮的编号。 */
    turn: number;
    /** 触发这一轮的那句话；窗口把它切掉时缺席（过程与回复照样画）。 */
    trigger?: {
        id: string;
        text: string;
        images?: TranscriptImage[];
        at: number;
    };
    /** 这一轮里读者中途插的话（非空 = 这一轮永不折）。 */
    interjections: {
        id: string;
        text: string;
        images?: TranscriptImage[];
        at: number;
    }[];
    /** 过程行，按发生顺序。 */
    steps: TranscriptStep[];
    /** 这一轮的助手回复，按发生顺序（`final` 档只露最后一条）。 */
    replies: TranscriptReply[];
    /** 这一轮结束时的时间戳；还在跑或窗口里没有 `turn/end` 时为 undefined。 */
    endedAt?: number;
    /** 结束原因（`completed` / `aborted` / `interrupted` / 其他）。 */
    endReason?: string;
}
/** The raw history-event slice the fold reads (structural, narrowed). */
export interface TranscriptEvent {
    type: string;
    seq?: number;
    time?: number;
    data?: unknown;
}
/**
 * 一段思考的识别与摘要：`content` 里的 `reasoning` 块。
 *
 * 只留**字数与首行**。整段思考通常几千字，折行里放不下、留在内存里也不划算；
 * 而「让读者知道它想了一下」只需要这两样。
 * @param content - 助手消息的 content。
 * @returns 每一段思考的摘要（空数组 = 没有思考）。
 */
export declare function reasoningOf(content: unknown): {
    chars: number;
    preview: string;
}[];
/**
 * Fold history events into turns (see module doc).
 *
 * 分组键是**轮号**：`turn/start` 开一轮，`turn/end` 收一轮，中间的事件按自己的
 * `data.turn` 归队；没有轮号的事件（注入、以及窗口被切掉时留下的消息）落在
 * 「当前这一轮」里。窗口从半轮开始时，第一条带轮号的助手消息会合成那一轮。
 * @param events - 会话历史事件（顺序即发生顺序）。
 * @returns 轮列表（按首次出现顺序）。
 */
export declare function foldTurns(events: readonly TranscriptEvent[]): TranscriptTurn[];
/**
 * The durable image refs one message content carries (structural): parts of
 * the shape `{type:'image', attachment:{attachmentId, mediaType, name?}}` —
 * exactly what the host stores after promoting the submitted bytes. Anything
 * malformed is skipped (never a crash on an unknown part).
 */
export declare function contentImagesOf(content: unknown): TranscriptImage[];
/** Sum the token accounting of every assistant reply in a turn list. */
export declare function sumUsage(turns: readonly TranscriptTurn[]): TranscriptUsage | undefined;
