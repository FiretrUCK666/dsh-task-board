/** Canonical `dsh-session:` URI for one opaque session id (lossless). */
export declare function encodeSessionReferenceUri(sessionId: string): string;
/** Escape the display label for the Markdown mention — the deployed grammar
 *  verbatim: `]` and `\` get a backslash prefix (`[` is deliberately NOT
 *  escaped — the host's parse pattern does not unescape it either). */
export declare function escapeSessionReferenceLabel(label: string): string;
/** Render a host-neutral Markdown mention carrying the canonical URI. */
export declare function formatSessionReferenceMention(reference: {
    sessionId: string;
    label?: string;
}): string;
