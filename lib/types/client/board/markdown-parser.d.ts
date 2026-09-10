/**
 * Minimal markdown parser for board surfaces (comments + session transcripts).
 * Produces a small node tree; the renderer (Markdown.tsx) maps it to React
 * elements — there is NO HTML string output, so there is no injection
 * surface. Only the safe, common subset is supported: paragraph text,
 * `#`–`###` headings, fenced code blocks, bullet/numbered lists, blockquotes,
 * thematic breaks, and inline **bold**, *italic* (single emphasis), `code`
 * and [links](url). Everything unrecognized renders as plain text. Pure and
 * line-based so it unit-tests in isolation.
 */
/** One inline leaf (text runs, or an emphasis/code/link span with children). */
export type InlineNode = {
    t: 'text';
    s: string;
} | {
    t: 'bold';
    children: InlineNode[];
} | {
    t: 'italic';
    children: InlineNode[];
} | {
    t: 'code';
    s: string;
} | {
    t: 'link';
    url: string;
    children: InlineNode[];
};
/** One top-level block. */
export type BlockNode = {
    t: 'paragraph';
    children: InlineNode[];
} | {
    t: 'heading';
    level: 1 | 2 | 3;
    children: InlineNode[];
} | {
    t: 'codeblock';
    lang: string;
    text: string;
} | {
    t: 'list';
    ordered: boolean;
    items: InlineNode[][];
} | {
    t: 'quote';
    children: BlockNode[];
} | {
    t: 'hr';
};
export declare function parseInline(source: string): InlineNode[];
/** Parse the whole source into top-level blocks. */
export declare function parseMarkdown(source: string): BlockNode[];
