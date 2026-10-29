/**
 * 一条消息携带的那张图——**官方 `ImageAttachmentRef` 的整份**。
 *
 * 官方的读图门（`sessions.attachment`）要的是一份**完整引用**：它按契约校验
 * ID、格式、**字节长度与尺寸**。发一份只剩 `attachmentId` 的瘦身版会**当场被拒**，
 * 界面于是降级成 `[图片]`——那个降级看起来像「图片坏了」，其实是读法不对。
 *
 * 所以这里的字段是**照官方的 required 集合**收的，而且只多不少：手抄一份字段表
 * 就是漏字段（这条写在 `AGENTS.md` 的不变量里）。`tests/attachment-contract.spec.ts`
 * 拿**实际安装的宿主声明文件**逐字段对账，官方加字段时它报红并指名。
 */
export interface TranscriptImage {
    attachmentId: string;
    mediaType: string;
    /** 精确字节长度（官方 required：读回时要按它校验）。 */
    bytes: number;
    /** 内在宽度（官方 required）。 */
    width: number;
    /** 内在高度（官方 required）。 */
    height: number;
    /** 显示名（官方 optional）。 */
    name?: string;
    /**
     * 归正前的原始尺寸（官方 optional，只在归一化缩过图时出现）。
     *
     * 它不参与渲染，但**必须跟着走**：宿主对这份引用的校验可能要看它，而
     * 「哪些字段能省」不是我们能猜的——`tests/attachment-contract.spec.ts` 就是
     * 拿官方声明逐字段比出来的，省掉它那条当场报红。
     */
    originalDimensions?: {
        width: number;
        height: number;
    };
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
    order: number;
}
/** 一段思考：只留字数与首行（正文太长，折行里放不下也不该占内存）。 */
 | {
    kind: 'reasoning';
    id: string;
    chars: number;
    preview: string;
    step: number;
    order: number;
}
/** 一次上下文注入（技能、指令文件、会话引用、定时通知…）。 */
 | {
    kind: 'context';
    id: string;
    producer: string;
    summary: string;
    at: number;
    order: number;
};
/** One assistant reply inside a turn. */
export interface TranscriptReply {
    id: string;
    text: string;
    images?: TranscriptImage[];
    at: number;
    usage?: TranscriptUsage;
    /** 这条回复属于哪一步（官方 `step`）。**它是最终回答边界的唯一依据**：
     *  官方的「最终回答」= 这一轮**最后一步**里那条带文字、且同一步没有工具调用的
     *  助手消息；它之前的每一条回复都算过程。少了这个号，就只能按「第几条」猜。 */
    step: number;
    /** 它在这条事件流里的到达次序。**顺序的唯一真相**：过程行与回复各自记序号，
     *  画的时候按号排，于是「思考 → 调工具 → 说一句 → 再调工具」就是它真实发生的
     *  顺序，而不是「先摆完所有工具、再摆所有话」。 */
    order: number;
}
/** 读者中途插的一句话。 */
export interface TranscriptInterjection {
    id: string;
    text: string;
    images?: TranscriptImage[];
    at: number;
    /** 它插在哪一步（按到达时的步号记）——插话要画在它真正打断的位置上。 */
    step: number;
    order: number;
}
/** 一条轮内的画序单元：过程行、回复、读者插话各是其中一种。 */
export type TurnFlowItem = {
    kind: 'step';
    order: number;
    step: TranscriptStep;
} | {
    kind: 'reply';
    order: number;
    reply: TranscriptReply;
} | {
    kind: 'reader';
    order: number;
    interjection: TranscriptInterjection;
};
/**
 * 一轮的「最终回答边界」——官方 `TurnProcessSpec` 的那三个字段。
 *
 * 官方的折叠不是「过程一块、回复一块」，而是先算出**最终回答从哪一步开始**：
 *
 *   `answerStep` = 这一轮**最后一步**（`turn.steps.at(-1)`）；
 *   那一步里**带文字、且那一步没有工具调用**的最后一条助手消息，就是最终回答；
 *   它**之前**的所有助手消息（哪怕是完整的一段落）都算过程，折起来。
 *
 * 少了这个边界，一长串工具调用和几句「途中说的话」会被排在同一层，于是读者看到的
 * 是「过程堆在上面、话接在下面，对不上哪句属于哪段」——那不是排序问题，是边界没算。
 */
export interface TurnAnswerBoundary {
    /** 最终回答所在的那一步。 */
    step: number;
    /** 那一步里作为最终回答的那条回复。 */
    replyId: string;
    /** 边界**之前**的回复条数（官方 `messageCount`：这些全算过程）。 */
    messageCount: number;
}
/**
 * 算出一轮的最终回答边界；还拿不出来时返回 undefined。
 *
 * 判据逐条照官方：只看**最后一步**；那一步有工具调用 = 这一轮还在干活，没有最终
 * 回答（整轮摊着）；最后一步里没有带文字的回复 = 同上（`latestAnswer` 返回 null）。
 * @param replies - 这一轮的回复，按发生顺序。
 * @param steps - 这一轮的过程行（用来判「那一步有没有工具调用」）。
 */
export declare function answerBoundaryOf(replies: readonly {
    id: string;
    text: string;
    step: number;
}[], steps: readonly {
    kind: 'tool' | 'reasoning' | 'context';
    step?: number;
}[]): TurnAnswerBoundary | undefined;
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
    interjections: TranscriptInterjection[];
    /** 过程行，按发生顺序。 */
    steps: TranscriptStep[];
    /** 这一轮的助手回复，按发生顺序（`final` 档只露最后一条）。 */
    replies: TranscriptReply[];
    /** 最终回答从哪一步开始（官方边界）；拿不出来时为 undefined。 */
    answer?: TurnAnswerBoundary;
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
 * 一条消息内容里带的那些耐久图片引用（结构性读取）。
 *
 * **整份走，不逐项重建。** 官方那份引用是 `ImageAttachmentRef`，宿主读图时会
 * 校验它的每个字段；手抄一份字段表就是漏字段——`originalDimensions` 就是这么
 * 被漏掉的（`tests/attachment-contract.spec.ts` 逐字段比出来才发现）。
 *
 * 所以：必填项在（校验通过就说明它是一份合法引用），就**原样带走**整份对象，
 * 官方以后再加字段，我们不需要改两处；必填项缺一项的那张跳过（读回来也过不了
 * 校验，发出去只会得到一句「图片坏了」）。
 * @param content - 一条消息的 `content` 数组。
 * @returns 去重后的引用，按出现顺序。
 */
export declare function contentImagesOf(content: unknown): TranscriptImage[];
/**
 * 一轮里「过程行 / 回复 / 读者插话」按**真实发生顺序**排成一条流。
 *
 * 这是「顺序对不上」那个病根的治法：过程与回复各自被收进两个数组，画的时候如果
 * 先摆完所有工具再摆所有话，读者看到的就是「四十行工具堆在上面、两句话接在下面」，
 * 而真实发生的是「思考 → 调工具 → 说一句 → 再调工具」。到达次序（`order`）是唯一真相，
 * 排序只在这里做一次。
 * @param turn - 一轮。
 * @returns 按 `order` 升序的流单元。
 */
export declare function flowOf(turn: TranscriptTurn): TurnFlowItem[];
/** Sum the token accounting of every assistant reply in a turn list. */
export declare function sumUsage(turns: readonly TranscriptTurn[]): TranscriptUsage | undefined;
