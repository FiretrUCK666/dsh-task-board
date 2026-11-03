/**
 * The resolver: what a caller SAID, turned into the value this system stores.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * The tools ask for INTERNAL values — `running`, `danger-full-access`, a
 * workspace uuid — while a person says 进行中, the interface prints 「Full access」,
 * and the configuration file keys it as `danger-full-access`. Three vocabularies
 * for one fact, and the model sat in the middle with nothing to translate with:
 * its only move was to memorise, and memorising is writing down, which goes
 * stale the moment a rule renames.
 *
 * The result was measurable, not theoretical: the catalog's own description said
 * `status` was 「五档之一：待规划 / 待办 / 进行中 / 待审核 / 已完成」 while the
 * validator compared against `backlog/todo/running/review/done`. A model that
 * followed the description was refused EVERY time, and the refusal named values
 * the description had never shown it.
 *
 * So the fix is not more rules — it is a translation layer between the words
 * callers actually use and the one spelling the document stores.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
 *
 *  · NOT a second validator. `checkParams` still owns "is this legal"; this owns
 *    "what did they mean". One is a gate, the other is a reading.
 *  · NOT a source of truth for the candidate lists. A resolver that hard-coded
 *    `read-only / workspace-write / danger-full-access` would be exactly the
 *    「写死」 this project forbids: the deployment's preset table is the authority,
 *    and it changes without this file. The candidates are PASSED IN.
 *  · NOT a guesser. An input it cannot read is REFUSED with the candidates
 *    attached; silently picking the nearest would be a confident wrong answer,
 *    which is the class of defect this whole surface is being rebuilt around.
 *
 * ── THE RULE FOR ADDING A VOCABULARY ────────────────────────────────────────
 *
 * A table is added here only when the SAME fact already has two spellings in this
 * repository (a stored value and a displayed word). A tidy synonym list invented
 * here would be a third vocabulary, and a third is worse than two: it would drift
 * from both.
 *
 * @module dsh-task-board/core/resolve
 */
import { type ItemPriority, type ItemStatusView } from './item.ts';
/** Which vocabulary a value belongs to. */
export type ResolveKind = 
/** A board column / checklist status. */
'status'
/** A checklist priority tier. */
 | 'priority'
/** A permission preset key, from the deployment's own table. */
 | 'permission'
/** A workspace, by id or by the name a person reads. */
 | 'workspace'
/** A model, as `provider/model` or as its display name. */
 | 'model'
/** An agent preset key. */
 | 'agentPreset';
/**
 * One candidate a caller could have meant: the stored value plus every spelling
 * that should resolve to it.
 *
 * `value` is the ONLY thing ever stored. `spellings` is purely for reading, and
 * `label` is what a refusal prints so the caller can correct itself in one move.
 */
export interface ResolveCandidate {
    readonly value: string;
    /** Every spelling that maps to this value, INCLUDING the value itself. */
    readonly spellings: readonly string[];
    /** What a human reads, when the deployment gave a name. */
    readonly label?: string;
}
/** What a resolver needs: the candidates for one kind, plus the clock. */
export interface ResolveContext {
    /** Read the candidates for a kind. Absent/empty means "this host cannot tell
     *  you", which is reported as such rather than as "no such value". */
    readonly candidatesOf: (kind: ResolveKind) => readonly ResolveCandidate[];
}
/** The answer: the stored value, or why it could not be read plus what is legal. */
export type Resolved = {
    readonly ok: true;
    readonly value: string; /** The value the caller said was an alias. */
    readonly via?: string;
} | {
    readonly ok: false;
    readonly why: string;
    readonly candidates: readonly string[];
};
/**
 * Normalise a spelling for comparison.
 *
 * CASE AND SEPARATORS ARE NOT MEANING. `Full access`, `full-access` and
 * `full_access` are one preset; `DeepSeek Default` and `deepseek default` are one
 * workspace. Lower-casing and folding runs of separators into one space is what
 * makes those the same word without any per-vocabulary table.
 *
 * CJK is untouched: a space cannot be folded into Chinese, and doing so would
 * change the spelling of a label someone typed.
 * @param raw - any input.
 * @returns the comparison key.
 */
export declare function resolveKeyOf(raw: string): string;
/**
 * The candidates this module can produce WITHOUT a host.
 *
 * Status and priority live in this repository's own enums, so they need nothing
 * from the deployment. `permission`, `workspace`, `model` and `agentPreset` are
 * the DEPLOYMENT's vocabulary and are handed in by the caller — a resolver that
 * invented them would be the 「写死」 this module's header refuses, and it would go
 * stale the moment a preset table changed.
 * @returns the built-in candidates for a kind, or an empty list.
 */
export declare function builtinCandidatesOf(kind: ResolveKind): readonly ResolveCandidate[];
/**
 * Read one value in one vocabulary.
 *
 * ORDER OF READING, and each step exists for a distinct failure:
 *
 *  1. EXACT stored value — the cheapest and the most certain. `running` is
 *     `running`.
 *  2. Any declared spelling of a candidate — the labels and the alternate
 *     tokens (`!1`, `p1`, 紧急).
 *  3. A workspace or model by its DISPLAY NAME — the case that made a model guess
 *     a uuid it cannot read.
 *
 * A value that matches NOTHING is a refusal carrying the candidate list, because
 * the caller's next move is to pick one — and a refusal that only says 「不认识」
 * costs a search where the list costs a glance.
 * @param kind - which vocabulary.
 * @param input - what the caller said, in any shape.
 * @param ctx - where the candidates come from.
 * @returns the stored value, or the refusal.
 */
export declare function resolveValue(kind: ResolveKind, input: unknown, ctx: ResolveContext): Resolved;
/**
 * The sentence a failed resolution becomes, ready to return to a caller.
 *
 * One place, so every refusal from this layer has the same shape: what was said,
 * why it did not resolve, and the list of what would have. A caller that can read
 * the list corrects itself in one retry; one that gets only the first half
 * searches.
 * @param kind - which vocabulary.
 * @param input - what the caller said.
 * @param resolved - the failure.
 * @returns the sentence.
 */
export declare function resolveWhy(kind: ResolveKind, resolved: Extract<Resolved, {
    ok: false;
}>): string;
/**
 * The candidate list for a kind from the two sources, in one place.
 *
 * The built-in enums answer for `status` and `priority`; the caller answers for
 * the deployment's own vocabularies. Composing them HERE rather than at each call
 * site is what makes 「the resolver knows the same values every time」 a property
 * of the module instead of a habit of its callers.
 * @param kind - which vocabulary.
 * @param fromHost - the deployment's candidates, when it has any.
 * @returns the candidate list to resolve against.
 */
export declare function candidatesFor(kind: ResolveKind, fromHost: readonly ResolveCandidate[]): readonly ResolveCandidate[];
/**
 * The stored status a view might have come from, or undefined.
 *
 * A tiny convenience over {@link resolveValue} for the one caller that wants the
 * narrow type back. It exists rather than a cast because a cast at the call site
 * is how a resolver's answer becomes a lie about the document.
 * @param resolved - a successful resolution of kind `status`.
 * @returns the value, narrowed to the status union when it really is one.
 */
export declare function statusOfResolved(resolved: Extract<Resolved, {
    ok: true;
}>): ItemStatusView | undefined;
/**
 * The priority tier a resolution produced, or undefined.
 * @param resolved - a successful resolution of kind `priority`.
 * @returns the tier, narrowed when it really is one.
 */
export declare function priorityOfResolved(resolved: Extract<Resolved, {
    ok: true;
}>): ItemPriority | undefined;
