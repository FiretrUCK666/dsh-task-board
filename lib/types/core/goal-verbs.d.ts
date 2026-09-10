/**
 * Native goal verbs for the board's session surfaces (pure domain logic):
 * the same five Remote mutations the harness's own GoalBar calls
 * (`remote.goals` get/edit/pause/resume/clear), with the CAS ref read at
 * verb call time from the live binding's `goal` projection — verbatim the
 * official grammar (no staleness fence on our side: the RPC's
 * compare-and-set is the guard, and a stale ref surfaces as an inline
 * error, never a silent no-op).
 *
 * Framework-free and structurally guarded: an absent binding, an absent
 * projection, or an absent remote degrades to a named failure (the strip
 * hides), never a throw — the same degrade law as every board host face.
 * Pure enough to unit-test with fakes.
 */
/** Compare-and-set identity for one exact goal revision. */
export interface GoalRef {
    id: string;
    revision: number;
}
/** One verb outcome: success, or a named failure for the inline error line. */
export type GoalVerbResult = {
    ok: true;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
    };
};
/** The structural slice of a session binding the verbs read the ref from. */
export interface GoalBindingFace {
    projections?: {
        faceOf(key: string): {
            getSnapshot(): unknown;
        } | undefined;
    };
}
/** The structural slice of the `remote.goals` Typert stub the verbs call. */
export interface GoalsRemoteFace {
    get(sessionId: string): Promise<unknown>;
    edit(sessionId: string, ref: GoalRef, patch: {
        objective: string;
    }): Promise<unknown>;
    pause(sessionId: string, ref: GoalRef): Promise<unknown>;
    resume(sessionId: string, ref: GoalRef): Promise<unknown>;
    clear(sessionId: string, ref: GoalRef): Promise<unknown>;
}
/** The verb bundle one session's goal strip calls. */
export interface GoalVerbs {
    /** The live CAS ref, read at call time; undefined when there is no
     *  current goal to mutate (unbound session, no projection, cleared). */
    ref(): GoalRef | undefined;
    get(): Promise<unknown>;
    edit(objective: string): Promise<GoalVerbResult>;
    pause(): Promise<GoalVerbResult>;
    resume(): Promise<GoalVerbResult>;
    clear(): Promise<GoalVerbResult>;
}
/** One verb failure (the inline-error shape). */
export type GoalVerbFailure = Extract<GoalVerbResult, {
    ok: false;
}>;
/** No current goal to mutate (the official `noCurrentGoal` verbatim). */
export declare function noCurrentGoal(): GoalVerbFailure;
/**
 * The session's current projected CAS ref, read at verb call time (no
 * staleness fence: the RPC's CAS is the guard). undefined = no current goal.
 */
export declare function goalRefOf(binding: GoalBindingFace | undefined): GoalRef | undefined;
/** Normalize one verb call outcome: a Typert `{ok}` envelope passes through;
 *  a throw becomes a named remote failure (never a crash at the click site). */
export declare function toVerbResult(raw: unknown, verb: string): GoalVerbResult;
/** Process-local continuation eligibility of one session's current goal. */
export type GoalActivation = 'armed' | 'disarmed';
/** The activation payload the `goal/activation-changed` event carries. */
export interface GoalActivationChanged {
    id: string;
    revision: number;
    activation: GoalActivation;
}
/**
 * The wiring face the controller holds: live-binding resolution + the
 * `remote.goals` stub + the activation subscription. The UI never touches
 * these directly — it calls `controller.goalVerbs(sessionId)`.
 */
export interface GoalServiceFace {
    bindingOf(sessionId: string): GoalBindingFace | undefined;
    remote: GoalsRemoteFace | undefined;
    subscribeActivation(sessionId: string, listener: (goal: GoalActivationChanged | undefined) => void): () => void;
}
/**
 * Bind the five verbs to one session from the wiring face. Thin wrapper over
 * {@link makeGoalVerbs} so callers hold one object, not three.
 */
export declare function verbsOf(service: GoalServiceFace, sessionId: string): GoalVerbs;
/**
 * Bind the five verbs to one session. `bindingOf` resolves the live binding
 * at CALL time (the ref must be fresh); `remote` is the `remote.goals` stub.
 * Either absent = every verb reports no-current-goal / remote-unavailable.
 */
export declare function makeGoalVerbs(bindingOf: (sessionId: string) => GoalBindingFace | undefined, remote: GoalsRemoteFace | undefined, sessionId: string): GoalVerbs;
