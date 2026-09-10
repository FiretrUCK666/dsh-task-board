/** One image attached to a message — the DURABLE ref form the host stores
 *  after admission (the browser submitted temporary bytes; the stored event
 *  carries the promoted reference). Renderers fetch the bytes through the
 *  official `sessions.attachment` read. */
export interface TranscriptImage {
    attachmentId: string;
    mediaType: string;
    name?: string;
}
/** One rendered transcript line: a real message or a context-injection row. */
export type TranscriptLine = {
    kind: 'message';
    /** Stable message id (falls back to the event sequence). */
    id: string;
    role: 'user' | 'assistant';
    /** The message's text (text blocks joined; image-only messages carry ''). */
    text: string;
    /** Images attached to the message (empty/absent when none). */
    images?: TranscriptImage[];
    /** Event timestamp (ms epoch); 0 when the event carried none. */
    at: number;
    /** Token accounting reported with the assistant message, when present. */
    usage?: TranscriptUsage;
} | {
    kind: 'context';
    /** Fallback identity (the event sequence). */
    id: string;
    /** The injecting plugin's name (native context rows name their source). */
    plugin: string;
    /** One-line account when the injection carries one (notice form). */
    summary: string;
    /** Event timestamp (ms epoch); 0 when the event carried none. */
    at: number;
};
/** Token accounting of one assistant message (native `usage` payload). */
interface TranscriptUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
}
/** The raw history-event slice the fold reads (structural, narrowed). */
export interface TranscriptEvent {
    type: string;
    seq?: number;
    time?: number;
    data?: unknown;
}
/**
 * Fold history events into the conversation tail (see module doc). Only
 * append-surface user and assistant messages produce lines; everything else
 * (tool results, chunks, turn markers) is skipped.
 */
export declare function foldTranscript(events: readonly TranscriptEvent[]): TranscriptLine[];
/**
 * The durable image refs one message content carries (structural): parts of
 * the shape `{type:'image', attachment:{attachmentId, mediaType, name?}}` —
 * exactly what the host stores after promoting the submitted bytes. Anything
 * malformed is skipped (never a crash on an unknown part).
 */
export declare function contentImagesOf(content: unknown): TranscriptImage[];
/** Sum the token accounting of every assistant message in a transcript. */
export declare function sumUsage(lines: readonly TranscriptLine[]): TranscriptUsage | undefined;
export {};
