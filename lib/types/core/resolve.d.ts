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
 * The strings a refusal prints for a candidate list.
 *
 * BOTH HALVES, because a refusal is read by a caller that has to pick one and by
 * a person reading over its shoulder: the stored value is what must be sent back,
 * and the label is what the caller recognises. Printing only the stored value is
 * the 「说明写中文、校验认英文」 defect in a new place.
 * @param candidates - the legal candidates.
 * @returns one `value（label）` string per candidate, or the bare value.
 */
export declare function namesOfCandidates(candidates: readonly ResolveCandidate[]): string[];
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
