/**
 * The host's refusal CODES, said in the reader's language.
 *
 * WHY THIS EXISTS, and it is not tidiness. Both the hand-off and the archive
 * answer with a CODE on purpose — the host decides the fact, the panel owns the
 * wording, and the wording has to be translated — and the panel was then
 * interpolating the code straight into a Chinese sentence. A reader whose host
 * was briefly unreachable was told, in the middle of an otherwise Chinese
 * paragraph, 「没能找回 #9: malformedAnswer」 or 「没能交给模型：noLiveAgent」. That
 * is the host's internal vocabulary printed where the reader is, and it is worse
 * than useless: `malformedAnswer` says the answer was broken when the host had in
 * fact said 「这个编号不对」, so the reader is sent to look for the wrong problem.
 *
 * **THE UNKNOWN CASE IS A SENTENCE, NOT THE CODE.** A code this table has never
 * heard of is still a code, and printing it is the thing being fixed — so an
 * unrecognised one gets the same generic sentence an unreachable host gets, and
 * the raw code goes into the element's `title` where a developer can find it and
 * a reader cannot be shown it by accident. A table that is complete today still
 * has to be honest tomorrow, and the honest answer to 「I do not know why」 is a
 * sentence that does not pretend.
 */
import { t, type TaskBoardKey } from '../locales.ts'

/** Every refusal code either host can send, and what the reader is told. */
const WHY_WORDS: Readonly<Record<string, TaskBoardKey>> = {
  // ── the archive / restore path ──
  noSuchItem: 'item.why.noSuchItem',
  gone: 'item.why.gone',
  // ── the hand-off path ──
  taskHasNoSession: 'item.why.taskHasNoSession',
  noLiveAgent: 'item.why.noLiveAgent',
  noSuchTask: 'item.why.noSuchTask',
  /**
   * The request named one card and a row belonging to another. There is no
   * reader-facing way to cause this — the panel sends its own row — so it is a
   * guard against a caller that does not, and the sentence says the truth about
   * the request rather than blaming the reader for a body they never wrote.
   */
  rowBelongsElsewhere: 'item.why.rowBelongsElsewhere',
  // ── the host itself ──
  hostUnavailable: 'item.why.hostUnavailable',
  hostStorageMissing: 'item.why.hostUnavailable',
  malformedAnswer: 'item.why.malformedAnswer',
  unrecognisedAnswer: 'item.why.malformedAnswer',
}

/** A code that reads as a transport failure however it is spelled. */
function isTransport(why: string): boolean {
  return why.startsWith('hostRefused') || why === 'AbortError' || why.includes('abort') || why.includes('fetch')
}

/**
 * What to print, and what to keep for a developer.
 *
 * @param why - the code the host or the transport sent.
 * @returns the reader-facing sentence, and the raw code for the tooltip.
 */
export function whyLabelOf(why: string): { readonly words: string; readonly raw: string } {
  const key = WHY_WORDS[why] ?? (isTransport(why) ? 'item.why.hostUnavailable' : 'item.why.unknown')
  return { words: t(key), raw: why }
}
