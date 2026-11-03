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
import { ITEM_PRIORITIES, ITEM_STATUS_VIEWS } from './item.ts'
import { PRIORITY_BY_TOKEN } from './item-query.ts'

/** Which vocabulary a value belongs to. */
export type ResolveKind =
  /** A board column / checklist status. */
  | 'status'
  /** A checklist priority tier. */
  | 'priority'
  /** A permission preset key, from the deployment's own table. */
  | 'permission'
  /** A workspace, by id or by the name a person reads. */
  | 'workspace'
  /** A model, as `provider/model` or as its display name. */
  | 'model'
  /** An agent preset key. */
  | 'agentPreset'

/**
 * One candidate a caller could have meant: the stored value plus every spelling
 * that should resolve to it.
 *
 * `value` is the ONLY thing ever stored. `spellings` is purely for reading, and
 * `label` is what a refusal prints so the caller can correct itself in one move.
 */
export interface ResolveCandidate {
  readonly value: string
  /** Every spelling that maps to this value, INCLUDING the value itself. */
  readonly spellings: readonly string[]
  /** What a human reads, when the deployment gave a name. */
  readonly label?: string
}

/** What a resolver needs: the candidates for one kind, plus the clock. */
export interface ResolveContext {
  /** Read the candidates for a kind. Absent/empty means "this host cannot tell
   *  you", which is reported as such rather than as "no such value". */
  readonly candidatesOf: (kind: ResolveKind) => readonly ResolveCandidate[]
}

/** The answer: the stored value, or why it could not be read plus what is legal. */
export type Resolved =
  | { readonly ok: true; readonly value: string; /** The value the caller said was an alias. */ readonly via?: string }
  | { readonly ok: false; readonly why: string; readonly candidates: readonly string[] }

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
export function resolveKeyOf(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_\-/]+/g, ' ')
}

/**
 * The values a status may be written as, with the words a reader sees.
 *
 * THE STORED VALUES COME FROM THE ENUM; THE CHINESE WORDS ARE TYPED HERE, and the
 * first version of this comment claimed both came from elsewhere — which is the
 * kind of comment that gets believed. `STATUS_LABELS` below carries a `DEBT:` note
 * naming the second copy in `client/locales.ts` and what extracting it costs.
 *
 * English synonyms (`doing`, `in progress`, `wip`) are NOT added: they are not
 * spellings THIS repository uses anywhere, and a synonym nobody writes is surface
 * for a wrong guess to land on. The two that matter are the stored key and the
 * label the columns print.
 */
/**
 * The Chinese words for the five columns, as a reader sees them.
 *
 * `DEBT: a SECOND copy of these ten strings lives in src/client/locales.ts`
 * (`board.status.*` / `item.priority.*`), and nothing keeps the two equal — this
 * module cannot import the client's dictionary because the half-boundary forbids
 * it. Hard rule 17 says one concept gets one vocabulary, and this is the one place
 * its violation is structural rather than careless: today the two copies are
 * character-for-character identical, and the day somebody rewords a column header
 * the resolver silently stops recognising the new word while every gate stays
 * green.
 *
 * The fix is to lift these ten strings into `core/` (which both halves may read)
 * and have `locales.ts` take them from there. That is a change to the dictionary's
 * own shape and is recorded here rather than half-done: an extraction that moved
 * only the five status words would leave the four tiers behind, which is the same
 * defect with a smaller count.
 *
 * The EN labels are not listed at all, and that is also a known gap: a deployment
 * running the English dictionary prints `In Progress`, and the resolver does not
 * recognise it. The delivery is Chinese, so this is the smaller half of the debt.
 */
const STATUS_LABELS: Readonly<Record<string, string>> = {
  backlog: '待规划',
  todo: '待办',
  running: '进行中',
  review: '待审核',
  done: '已完成',
}

/** The same, for the four priority tiers. */
const PRIORITY_LABELS: Readonly<Record<string, string>> = {
  urgent: '紧急',
  high: '高',
  normal: '普通',
  low: '低',
}

/**
 * The candidates for a status.
 * @returns one candidate per column, carrying the stored key and both labels.
 */
function statusCandidates(): readonly ResolveCandidate[] {
  return ITEM_STATUS_VIEWS.map(value => ({
    value,
    spellings: [value, STATUS_LABELS[value] ?? value],
    label: STATUS_LABELS[value] ?? value,
  }))
}

/**
 * The candidates for a priority tier.
 *
 * The `!N` and `pN` spellings are the SAME ladder the row's mark and the search
 * box use (`PRIORITY_BY_TOKEN` / `PRIORITY_DIGIT`), so they resolve here rather
 * than being retyped: a second digit table would be a second answer to 「which
 * number is 紧急」.
 * @returns one candidate per tier.
 */
function priorityCandidates(): readonly ResolveCandidate[] {
  return ITEM_PRIORITIES.map(value => {
    const token = Object.entries(PRIORITY_BY_TOKEN).find(([, tier]) => tier === value)?.[0] ?? ''
    const digit = token.startsWith('p') ? token.slice(1) : ''
    return {
      value,
      spellings: [
        value,
        PRIORITY_LABELS[value] ?? value,
        ...(token === '' ? [] : [token, `!${digit}`]),
      ],
      label: PRIORITY_LABELS[value] ?? value,
    }
  })
}

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
export function builtinCandidatesOf(kind: ResolveKind): readonly ResolveCandidate[] {
  switch (kind) {
    case 'status': return statusCandidates()
    case 'priority': return priorityCandidates()
    case 'permission':
    case 'workspace':
    case 'model':
    case 'agentPreset':
      // The deployment's own vocabulary. Empty here is not "none exist": it is
      // "this module cannot know", which the caller answers by supplying them.
      return []
  }
}

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
export function resolveValue(kind: ResolveKind, input: unknown, ctx: ResolveContext): Resolved {
  const said = typeof input === 'string' ? input : input === undefined || input === null ? '' : String(input)
  if (said.trim() === '') {
    return { ok: false, why: '这个值不能是空的', candidates: namesOfCandidates(ctx.candidatesOf(kind)) }
  }
  const candidates = ctx.candidatesOf(kind)
  if (candidates.length === 0) {
    // HONEST ABSENCE. "This host cannot tell you the legal values" is a different
    // answer from "your value is wrong", and answering it as the second would send
    // the caller to fix a value nobody could have judged.
    return {
      ok: false,
      why: `这个部署没有提供 ${kind} 的可选值，所以只能给规范值——而这一句话没法替你猜`,
      candidates: [],
    }
  }
  const key = resolveKeyOf(said)
  // 1. the stored value itself, compared exactly: an id is an id.
  const exact = candidates.find(candidate => candidate.value === said.trim())
  if (exact !== undefined) return { ok: true, value: exact.value }
  // 2. any declared spelling, compared through the folding rule.
  for (const candidate of candidates) {
    if (candidate.spellings.some(spelling => resolveKeyOf(spelling) === key)) {
      return candidate.value === said.trim() ? { ok: true, value: candidate.value } : { ok: true, value: candidate.value, via: said.trim() }
    }
  }
  return {
    ok: false,
    why: `「${said.trim()}」不是认识的值`,
    candidates: namesOfCandidates(candidates),
  }
}

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
export function namesOfCandidates(candidates: readonly ResolveCandidate[]): string[] {
  return candidates.map(candidate =>
    candidate.label === undefined || candidate.label === candidate.value
      ? candidate.value
      : `${candidate.value}（${candidate.label}）`)
}

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
export function resolveWhy(kind: ResolveKind, resolved: Extract<Resolved, { ok: false }>): string {
  if (resolved.candidates.length === 0) return `${kind}：${resolved.why}`
  return `${kind}：${resolved.why}。可选：${resolved.candidates.join(' / ')}`
}

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
export function candidatesFor(kind: ResolveKind, fromHost: readonly ResolveCandidate[]): readonly ResolveCandidate[] {
  const builtin = builtinCandidatesOf(kind)
  return builtin.length > 0 ? builtin : fromHost
}
