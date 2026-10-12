/**
 * Attachments, in ONE place: what a document stores, what the send path
 * consumes, and the one bridge between them.
 *
 * WHERE THE BYTES LIVE. The harness already owns a durable, content-addressed
 * attachment store (`ctx.attachments`, the objects under the DSH data root) and
 * the native composer has always uploaded through it. This plugin therefore
 * stores NOTHING itself: a document carries a reference, and the bytes are read
 * back through the host route that fronts that same store. A plugin-owned folder
 * would be a second home for the same bytes — two places to back up, two places
 * to outlive their refs, and one of them invisible to the harness.
 *
 * THREE AGES OF THE SAME FIELD, and only one reader. `attachments` is what new
 * writes produce. Two older shapes still sit in real documents:
 * `promptImages` (base64 temporary bytes) and `promptFiles` (per-Agent
 * receipts). {@link attachmentsOf} is the ONLY reader of those two — the send
 * path, the comment caption and every surface go through it, so nothing else in
 * the plugin has to know that an older document exists. A record is migrated
 * when it is next EDITED (never on load: a background rewrite of every replica's
 * document is a write nobody asked for).
 * @module dsh-task-board/core/attachment
 */
/**
 * One durable attachment as a document carries it (bytes live in the store).
 *
 * ── THE REF IS THE OFFICIAL VALUE, AND ITS FIELD TABLE IS NOT OURS TO COPY ───
 *
 * Everywhere a ref travels — into a document, out through the host route, into
 * the store call, across a relay — it travels WHOLE. The only edit any of those
 * places may make is dropping the two keys that belong to this plugin's own
 * older shapes (`data`, `receiptId`), written as `const { data, receiptId,
 * ...rest } = ref`. An enumerated "keep these keys" list is what broke the image
 * lane: the official image ref carries `width`/`height` beside the three keys a
 * file ref has, several hand-copied tables kept only the keys their author knew,
 * and the store's read-back check compares all four — so a picture a reader had
 * just attached arrived at the store as an incomplete reference and was refused
 * as corrupt. A field the harness adds tomorrow must ride every one of those
 * places with no edit here; a list cannot promise that, and neither can a
 * compiler, because the whole boundary is structural (read by name, never
 * imported).
 *
 * WHERE LISTING IS STILL REQUIRED: {@link normalizeAttachmentRefs} ingests
 * untrusted persisted data into this model, so it names exactly what a document
 * may hold — a spread there would let an arbitrary key into a document. That is
 * a boundary filter, not a transport.
 */
export interface AttachmentRef {
    /** Content-addressed id in the official attachment store. */
    attachmentId: string;
    /** Display name, already stripped of any local path by the store. */
    name: string;
    /** Exact byte length (shown, never a gate here). */
    bytes: number;
    /** Present for images: the display lane and the prompt part's media type. */
    mediaType?: string;
    /** Present for images: intrinsic size, used by the thumbnail's box. */
    width?: number;
    height?: number;
}
/**
 * One attachment as the SEND path needs it: exactly one source of bytes, in
 * order of preference. A new record fills `attachmentId`; an older one fills
 * `data` (temporary bytes, self-contained) or `receiptId` (a per-Agent stage
 * that dies with its session). The materializer picks the first available
 * source and reports honestly when a source is gone.
 *
 * The display fields are optional because both shapes carry them optionally —
 * a file ref has no media type, an older image ref has no intrinsic size — and
 * a materializer that demanded them would refuse references that are perfectly
 * readable. They are carried, never required (see {@link AttachmentRef}).
 */
export interface PromptAttachment {
    name: string;
    bytes: number;
    /** Images only — the wire part's media type. */
    mediaType?: string;
    /** Images only — intrinsic size, carried so the read-back can prove identity. */
    width?: number;
    height?: number;
    /** Durable source: read the bytes back from the official store. */
    attachmentId?: string;
    /** Legacy source: the temporary-bytes part this record was born with. */
    data?: string;
    /** Legacy source: a staged receipt, valid only for its own session. */
    receiptId?: string;
}
/**
 * The two keys this plugin's OWN older shapes fill, and the whole extent of what
 * may be removed from a REF on its way anywhere ({@link AttachmentRef}). They are
 * sources, not ref fields: a ref that somehow carries one must not have its bytes
 * taken from it, and neither key has any meaning on another machine. An
 * envelope's own local key (a composer chip's `id`) is a different matter — it
 * was never part of the reference ({@link wholeRefOf} only ever removes these).
 */
export type OwnSourceKeys = 'data' | 'receiptId';
/**
 * One ref as it travels: the whole value, minus this plugin's own two source
 * keys. THE one place that edit is written — every lane that moves a ref (the
 * send path, the relay, a record's own attachment table, the read-back request)
 * goes through it, so no two lanes can disagree about what an attachment is, and
 * none of them can silently drop a field the harness added.
 * @param ref - a durable ref, or this plugin's own prompt-attachment shape.
 * @returns the same value with `data` / `receiptId` removed.
 */
export declare function wholeRefOf<T extends {
    name: string;
    bytes: number;
} & Partial<Record<OwnSourceKeys, unknown>>>(ref: T): Omit<T, OwnSourceKeys>;
/** The record fields {@link attachmentsOf} reads (all three ages). */
export interface AttachmentCarrier {
    /** Read-only on purpose: every real carrier (a task, a round, a checklist row) holds its table as a readonly field, and this view never writes one. */
    attachments?: readonly AttachmentRef[];
    /** Legacy: base64 temporary bytes persisted by an older revision. */
    promptImages?: readonly {
        mediaType?: string;
        data?: string;
        name?: string;
    }[];
    /** Legacy: staged receipts persisted by an older revision. */
    promptFiles?: readonly {
        receiptId?: string;
        name?: string;
        bytes?: number;
    }[];
}
/**
 * Normalize one persisted attachment list: unusable rows are dropped, a usable
 * row keeps only the fields this model knows. A row without an id cannot be
 * read back from the store, so it is not an attachment here.
 * @param raw - the persisted value.
 * @returns the refs, or undefined when there are none.
 */
export declare function normalizeAttachmentRefs(raw: unknown): AttachmentRef[] | undefined;
/**
 * 两份附件表**是不是同一份**——问的是「这次改动动了它没有」。
 *
 * 比的是内容寻址的 id、名字与字节数三项，而不是整对象：`mediaType` / `width` /
 * `height` 是显示用的补充信息，同一份字节补不补它们都还是那个附件，而把它们算进
 * 「变了没」会让一次纯粹的补充渲染算成一次修改、盖一次戳、把每台设备都叫醒。
 * `undefined` 与空表**不是同一件事**（前者是「没人说过」，后者是「一个都不留」），
 * 所以两端各自缺席时才相等。
 *
 * 一处定义：清单那条 patch 的「按值比」与会话规则那条 patch 的「按值比」是同一个问题。
 *
 * ── 这不是传输用的字段表 ─────────────────────────────────────────────────────
 *
 * 三项是**「同一份字节还是不是那一份」**的判据，不是「送出去要带哪几个键」。谁要送一份 ref
 * 出去，整份带走（{@link wholeRefOf}）——照着这三项去拼一份传输用的对象，会把
 * `mediaType` / `width` / `height` 连同官方将来补的任何字段一起丢掉，而这里一个字都不会报。
 * @param a - 左表。
 * @param b - 右表。
 * @returns 两份表是否逐条相同。
 */
export declare function sameAttachmentRefs(a: readonly AttachmentRef[] | undefined, b: readonly AttachmentRef[] | undefined): boolean;
/**
 * 一份附件里**能随中转走**的那一条车道，以及走不了的有几个。
 *
 * ── 为什么只有 ref 走得动 ────────────────────────────────────────────────────
 *
 * 中转是「这一台不是引擎，请引擎替我发」的那条路（`host-sync` 的 `requestLaunch` /
 * `requestComment`）。ref 走得了，因为字节在**官方附件库**里、两台机器读的是同一份；
 * 另两代走不了，而且**不该被塞进这份命令**：`receiptId` 是**只对某一个 Agent 有效**的
 * 票据（在另一台机器上毫无意义），内联的 `data` 则是一段会把命令撑大的字节。
 *
 * ── 走不了的不许静默消失 ──────────────────────────────────────────────────────
 *
 * 所以这一份读法把「丢了几个」一起交回来，调用点据此**出声**（`host-sync` 记一条日志）。
 * 今天这条路上不会有老形状——清单的附件只有 ref 这一代——但「今天不可能」不是一条可以
 * 依赖的性质：一个安静丢掉的附件，屏上没有任何东西解释它去了哪儿。
 * @param attachments - 调用点要送出去的那一份（三代形状都可能）。
 * @returns 能中转的 ref，以及走不了的那几个的条数。
 */
export declare function relayLaneOf(attachments: readonly PromptAttachment[] | undefined): {
    refs: AttachmentRef[];
    dropped: number;
};
/**
 * Every attachment one record carries, in document order, whichever age wrote
 * it. THE one bridge: the send path, the caption and the surfaces all read
 * this, so a legacy document cannot be visible to one of them and invisible to
 * another.
 * @param carrier - the record (or any object carrying the three field ages).
 * @returns the attachments as the send path consumes them.
 */
export declare function attachmentsOf(carrier: AttachmentCarrier | undefined): PromptAttachment[];
/** How many of each lane a set of attachments carries. */
export interface AttachmentCounts {
    images: number;
    files: number;
}
/**
 * The caption's reading: images are the ones with a media type, everything else
 * is a file. ONE reader for the comment thread's 「含 N 张图片 / N 个文件」, so
 * the two lanes cannot be counted by two different rules.
 * @param attachments - refs or prompt attachments (only `mediaType` is read).
 * @returns the two counts.
 */
export declare function attachmentCountsOf(attachments: readonly {
    mediaType?: string;
}[]): AttachmentCounts;
