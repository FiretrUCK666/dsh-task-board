/**
 * Minimal markdown parser for board surfaces (comments + session transcripts +
 * the plan under review). Produces a small node tree; the renderer
 * (Markdown.tsx) maps it to React elements — there is NO HTML string output, so
 * there is no injection surface. Only the safe, common subset is supported:
 * paragraph text, `#`–`######` headings (all six, like the official parser),
 * fenced code blocks, bullet/numbered lists
 * (one or more levels deep, with task-list marks `- [ ]` / `- [x]`),
 * blockquotes, thematic breaks, pipe tables with an alignment row, and inline
 * **bold**, *italic* (single emphasis), `code` and [links](url). Everything
 * unrecognized renders as plain text. Pure and line-based so it unit-tests in
 * isolation.
 *
 * ── WHY THE NESTING IS HERE AT ALL ──────────────────────────────────────────
 *
 * 一份计划几乎一定是「几条，每条下面几条」的形状，而这一层此前只认**平的一层**：
 * 缩进被丢掉，子项变成兄弟项。于是「/plan 的计划」在界面上读起来是一串并排的短句
 * ——不是排版难看，是**层次被抹掉了**：读者看不出哪几条属于同一步。
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
/**
 * One list item: its own line, what the item SAYS about being done (a task-list
 * mark), and whatever sits deeper underneath it.
 *
 * `blocks` is what makes nesting representable instead of merely indented — a
 * nested list is a block like any other, so a level of a different kind
 * (numbered inside bulleted) is not flattened into its parent's kind.
 */
export interface ListItem {
    children: InlineNode[];
    /** 任务清单的记号：`- [ ]` 是 false、`- [x]` 是 true；没写这一项的普通项没有它。 */
    checked?: boolean;
    /** 挂在这一条下面的块（更深的一层清单）。平的一项就是空表。 */
    blocks: BlockNode[];
}
/** How one table column is aligned (read off the separator row). */
export type TableAlign = 'left' | 'center' | 'right';
/** 标题级别。**六级全收**：官方的解析器认 `#{1,6}`，而我们曾经只认前三级，
 *  于是 agent 写的 `#### 小节` 会被当成普通段落，把四个井号连同文字一起印在屏上。 */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
/** One top-level block. */
export type BlockNode = {
    t: 'paragraph';
    children: InlineNode[];
} | {
    t: 'heading';
    level: HeadingLevel;
    children: InlineNode[];
} | {
    t: 'codeblock';
    lang: string;
    text: string;
} | {
    t: 'list';
    ordered: boolean;
    items: ListItem[];
} | {
    t: 'quote';
    children: BlockNode[];
} | {
    t: 'table';
    align: readonly TableAlign[];
    head: InlineNode[][];
    rows: InlineNode[][][];
} | {
    t: 'hr';
};
export declare function parseInline(source: string): InlineNode[];
/** Parse the whole source into top-level blocks. */
export declare function parseMarkdown(source: string): BlockNode[];
