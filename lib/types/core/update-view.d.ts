/**
 * The `/update` route's wire vocabulary — the shapes host serves and the
 * browser reads.
 *
 * ── 为什么它在核心层 ────────────────────────────────────────────────────────
 *
 * 这些是**协议**：host 写出来，浏览器读回去。浏览器不能 import host（那是半区
 * 倒置），所以它们住在核心层——两边都能 import 的那一层。
 *
 * 它们曾经各有两份：host 一份、浏览器一份，逐字相同的那份连注释都一样。
 * 抄一份的代价不是那几行，是**改一处不报错**：host 那份加了一个字段，浏览器
 * 那份不知道，于是浏览器的解析器安静地把它丢掉，而屏上只是「少显示了一栏」。
 *
 * 形状只有一份，`update-check.ts` 里的**计划**（这次更新要跑什么）与这里的
 * **视图**（现在是什么状态）是两件事：前者是判定，后者是读数。
 * @module dsh-task-board/core/update-view
 */
import type { ClientReport } from './client-report.ts';
import type { UpdateGitStatus, UpdateInstallMode, UpdateLatestView, UpdatePlan } from './update-check.ts';
/** How the host established which copy is running. */
export interface UpdateEvidence {
    /** This copy is a link into a checkout, not a copy installed in a profile. */
    linked: boolean;
    /** The host declared a profile at all. */
    declared: boolean;
    /** The declaration named a different copy than the one actually running. */
    disagreement: boolean;
}
/**
 * The installed-source view the host update route serves.
 *
 * `evidence` and `clients` are OPTIONAL on the wire: an older host sends
 * neither, and a reader that demanded them would say 「读不到」 about a perfectly
 * good answer. The host always fills both in.
 */
export interface UpdateSourceView {
    /** Package name (the npm update command's subject). */
    packageName: string;
    /** The running copy's version. */
    version: string;
    /** Raw profile-manifest declaration (absent when the host cannot read it). */
    spec?: string;
    /** Classified install mode. */
    mode: UpdateInstallMode;
    /** The profile carrying this copy (absent when the running profile is unreadable). */
    profile?: string;
    /** The profile's directory, or the checkout this copy runs from. */
    dir?: string;
    /** The profile belongs to a packaged application, which installs through its own runtime. */
    appManaged: boolean;
    /** How this copy's identity was established (absent from an older host). */
    evidence?: UpdateEvidence;
    /** The `github:` install spec (absent when the repo URL is not GitHub). */
    githubSpec?: string;
    /** How to update this copy, and who applies it. */
    plan: UpdatePlan;
    /** The newest upstream, when the host could read one (absent is "cannot tell"). */
    latest?: UpdateLatestView;
    /** Local-checkout git state (only for `local` installs). */
    git?: UpdateGitStatus;
    /** Self-reports from the pages that are currently open (newest first). */
    clients?: readonly ClientReport[];
}
/**
 * How an applied update landed.
 *
 * `unchanged` is the case the installation service cannot report: it answers
 * with what the package manager did, and a package manager asked for "the
 * latest" that resolves to the version already installed exits successfully
 * having done nothing at all. A package update's whole subject is its version,
 * so a run that left the version alone is not an update — and reporting one is
 * how a page tells a reader they are current when the resolution was merely
 * held back (an installer's release-age policy does exactly that to a version
 * that was published minutes ago). Only `npm` mode claims it: a branch install
 * can move without any version changing.
 */
export type UpdateApplyOutcome = 'applied' | 'restart-required' | 'rebuilt' | 'unchanged';
/** Why an update could not be applied (a stable code the page turns into copy). */
export type UpdateApplyError = 
/** This install mode has no host-side update path at all. */
'unsupported'
/** The update path exists but this host is missing what runs it. */
 | 'unavailable'
/** The checkout has uncommitted changes. */
 | 'dirty'
/** A command the update needs is not installed. */
 | 'tool-missing' | 'timeout' | 'failed';
/** What applying an update did. */
export interface UpdateApplyResult {
    ok: boolean;
    /** Present when `ok`: how the change landed. */
    outcome?: UpdateApplyOutcome;
    /** The version now on disk, when it could be read back. */
    version?: string;
    /** The tail of what the update printed, kept for failures. */
    output?: string;
    /** Present when not `ok`: why it did not happen. */
    error?: UpdateApplyError;
}
