/**
 * The workbench's ONE check-for-updates controller.
 *
 * WHY THIS IS NOT PAGE STATE. The bar is shared by three pages, and the reader's
 * rule is that 「检查更新」 sits in the same place on all of them — so the state
 * behind it cannot belong to whichever page happens to be mounted. A panel
 * unmounts every time the reader switches to a conversation, and page-owned
 * state would throw away a check that is still running (or a dialog the reader
 * left open) for no reason they could see.
 *
 * So it is a module singleton, the same shape as `workbenchStage`: one place
 * that knows what the last answer was, and every bar reads it.
 *
 * WHY THE PANEL DOES NOT PASS A CLIENT. `update-source.ts` is already the
 * browser's whole face on the host route (bounded fetches, every failure
 * degrading to `undefined`). A seam for tests would be a second way in; the
 * spec exercises the same functions the panel calls.
 */
import type { UpdateApplyResult, UpdateSourceView } from '../update-source.ts';
/** What pressing the button last did. */
export type UpdatePhase = 'idle' | 'checking' | 'latest' | 'available' | 'undetermined' | 'failed';
/** What the applied update last did. */
export interface UpdateApplyState {
    readonly phase: 'idle' | 'running' | 'done' | 'unchanged' | 'failed';
    readonly result?: UpdateApplyResult;
}
/** Everything a surface may read. */
export interface UpdateState {
    readonly phase: UpdatePhase;
    readonly source: UpdateSourceView | undefined;
    readonly apply: UpdateApplyState;
    /** Whether the result dialog is open. */
    readonly open: boolean;
    /** Whether the copyable command was just copied (a 1.5s flash). */
    readonly copied: boolean;
    /** Whether that copy attempt failed. */
    readonly copyFailed: boolean;
}
/** Listeners re-render their own subtree; there is no polling. */
type Listener = () => void;
/**
 * The controller. One instance, exported below.
 *
 * Reads are cheap and synchronous (`state()`), which is what a bar needs during
 * render. Writes notify every listener once, so all three bars stay in step.
 *
 * ── THE READ MUST BE IDENTITY-STABLE ────────────────────────────────────────
 *
 * `useSyncExternalStore` compares the snapshot it just read with the previous
 * one by REFERENCE. A `state()` that built a fresh object on every call would
 * look changed forever, so React would re-render, read again, see "changed"
 * again — and hit its update-depth limit. That is not a hypothetical: this
 * controller shipped that bug for one round and 151 tests went red with
 * 「Maximum update depth exceeded」.
 *
 * So `state` is a FIELD, not a builder: it is replaced only inside `emit()`,
 * which is called exactly once per change. Readers get the same object until
 * something actually changes.
 */
export declare class UpdateController {
    private phase;
    private source;
    private apply;
    private open;
    private copied;
    private copyFailed;
    private readonly listeners;
    private timer;
    /** The identity-stable snapshot (see the class doc). */
    private snapshot;
    /**
     * Subscribe to changes.
     * @param listener - called once per change; must be cheap.
     * @returns the unsubscribe function (call it from the effect's cleanup).
     */
    subscribe(listener: Listener): () => void;
    /** The current reading, for `useSyncExternalStore`. Same object until a change. */
    state: () => UpdateState;
    /** Everything derived from `source`, computed once per read. */
    derived(): UpdateDerived;
    /**
     * Private: publish one new snapshot, then notify.
     *
     * The snapshot is rebuilt HERE and nowhere else, so its identity changes
     * exactly when something changed — which is the whole contract the hook needs.
     */
    private emit;
    /** Clear the one-shot timer (idempotent). */
    private clearTimer;
    /**
     * Return to the resting state: no source, no dialog, no result, no timer.
     *
     * WHY THIS EXISTS IN THE PRODUCT AND NOT ONLY IN TESTS. The controller is a
     * singleton, so its state outlives any one panel — that is the point (a check
     * must survive a page switch). But a singleton also means STATE LEAKS BETWEEN
     * SCENARIOS: one test that opens the dialog leaves it open for the next, and
     * the second test then measures a screen it never asked for. A reset that the
     * tests can call is also the honest way for the product to say "forget the
     * last answer" — e.g. after a live reload swaps the bundle.
     */
    reset(): void;
    /** Private: the "attention borrowed for 2.5s, then back to rest" grammar. */
    private restAfter;
    /**
     * Ask the host once: which copy is running, where, what is newest, and how it
     * updates. One round trip answers all four (see `update-source.ts`).
     *
     * The newest-version answer comes from the host on purpose: it knows which
     * registry this profile uses, so a reader behind a mirror gets an answer, and
     * a git install gets a comparison at all.
     */
    check(): void;
    /** Show or hide the result dialog. */
    setOpen(open: boolean): void;
    /**
     * Copy the update command. Best-effort: a blocked clipboard reads as a failed
     * copy, never as a thrown error, and the flash is a 1.5s one-shot.
     * @param command - the line the dialog displays.
     */
    copyCommand(command: string): void;
    /**
     * Press "update": the host applies the plan it derived itself, and the source
     * is re-read afterwards.
     *
     * The re-read is REQUIRED, not defensive: a live reload can swallow the
     * answer, and "the host's version moved" is itself proof the update landed —
     * without it a successful update gets reported as a failure.
     */
    run(): void;
}
/** The readings a dialog needs, derived once from one source view. */
export interface UpdateDerived {
    /** The running copy's version. */
    readonly current: string;
    /** The newest upstream, when the host could read one. */
    readonly latest: UpdateSourceView['latest'];
    /** Whether `latest` is newer than `current`. */
    readonly newer: boolean;
    /** Local-checkout git state (only for `local` installs). */
    readonly git: UpdateSourceView['git'];
    /** Whether that checkout is behind its remote. */
    readonly gitBehind: boolean;
    /** How to update this copy, and who applies it. Absent before the first check. */
    readonly plan: UpdateSourceView['plan'] | undefined;
}
/**
 * Derive the dialog's readings from one source view.
 * @param source - the last source view, or undefined before the first check.
 * @returns the readings; every field has a defined "unknown" value.
 */
export declare function deriveOf(source: UpdateSourceView | undefined): UpdateDerived;
/** THE single controller, exported so every page's bar reads THIS one. */
export declare const updateController: UpdateController;
export {};
