/**
 * 官方 `@file` 文法镜像 —— 与 `@deepseek-ai/dsh-file-reference/grammar`
 * 逐字一致（同源同义），供板上所有输入框使用。
 *
 * 为什么不直接 import 官方包：部署的客户端打包门禁（dsh-client-bundle-purity）
 * 禁止跨插件值导入——插件间只能通过 cordis 服务协作，值导入无法通过构建。
 * 因此把官方两个纯函数原样镜像为本文件；**契约测试（tests/file-reference-
 * grammar.spec.ts）按官方行为钉死**，文法演进时对照官方源同步即可，绝不由
 * 本插件的口味改动。镜像是浏览器安全的纯函数，无运行时依赖。
 */
/** Active `@` token ending at the editor cursor. */
export interface ActiveAtToken {
    /** Complete token replaced when the user accepts a completion. */
    prefix: string;
    /** Path query after `@` or `@"`. */
    query: string;
    /** Whether the user opened a quoted path. */
    quoted: boolean;
}
/**
 * Extract an `@path` or `@"path with spaces` token at the cursor. An `@`
 * inside another token, such as an email address, is not a completion trigger.
 * @param line - current editor line.
 * @param cursorCol - cursor column within that line.
 * @returns the active token, or `undefined` outside an `@` token.
 */
export declare function activeAtToken(line: string, cursorCol: number): ActiveAtToken | undefined;
/** One file/directory reference candidate of the official discovery. */
export interface FileReferenceCandidateShape {
    kind: 'file' | 'directory';
    path: string;
}
/**
 * Format a selected path as prompt text. Whitespace uses the quoted
 * `@"path"` grammar; a quoted directory keeps that quote open after its
 * trailing slash so completion can descend another level.
 * @param candidate - selected file or directory.
 * @param preserveQuote - retain an explicitly opened quote even when unnecessary.
 * @returns the insertion value, or `undefined` for a path the editor grammar cannot represent safely.
 */
export declare function formatFileMention(candidate: FileReferenceCandidateShape, preserveQuote: boolean): string | undefined;
