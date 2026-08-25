/**
 * THE ONE '@' reference bridge of the board — every input box (comments,
 * refine answers, rule instructions, run prompts, interaction answers)
 * reads this module, so the whole board shares the OFFICIAL mechanism the
 * harness's own composer uses (`@deepseek-ai/dsh-client-ui-reference`):
 *
 * - candidates: the same two Remote namespaces (`remote.fileReferences` and
 *   `remote.sessionReferenceResolver`) fetched in parallel — files AND
 *   sessions in one menu, exactly like the native composer;
 * - insertion text: the OFFICIAL grammars from
 *   `@deepseek-ai/dsh-file-reference/grammar` (`@path` / `@"path"` with
 *   directory-descent quotes) and the canonical `@[label](dsh-session:…)`
 *   mention the host pre-serializes on each session candidate;
 * - resolution: nothing else is needed — the host scans ANY user message at
 *   agent pre-step (`parseSessionReferenceText`) and materializes cited
 *   sessions / guides files, no matter which surface typed the text.
 *
 * Failure contract (the OFFICIAL guarantee, from the web file/session
 * reference design note): "either candidate domain can fail independently
 * without hiding the rows the other domain returned." This module therefore
 * NEVER rejects and NEVER couples the two halves: a missing face, an RPC
 * rejection, a host `{ok:false}` envelope and a malformed candidate row each
 * degrade only their own half / row. What happened is reported in `diag`,
 * so the menu can show it honestly instead of a bare "no match".
 */
import { formatFileMention } from './file-reference-grammar.ts'
import { t } from '../locales.ts'
import type {
  ReferenceFileCandidate,
  ReferenceRemoteFace,
  ReferenceSessionCandidate,
} from '../../core/controller.ts'

/** One ready-to-render '@' menu row (display + the official splice text). */
export interface ReferenceRow {
  /** Group key: 'files' | 'sessions' (the official menu sections). */
  section: 'files' | 'sessions'
  /** Display title, already prefixed like the official menu (`文件 · x`). */
  name: string
  /** Secondary line (path / session metadata), when the official menu shows one. */
  description?: string
  /** Stable row key. */
  key: string
  /** The official mention text to splice over the @ token. */
  insert: string
  /** Keep the completion open after the splice (directory quote descent). */
  continue?: boolean
}

/** Why one half produced no rows — the OFFICIAL log-only contract: a failed
 *  source is removed from the menu silently and logged (the official
 *  ui-reference behaves exactly this way); the menu never carries a failure
 *  text. `code` is the host envelope's error code when one was carried. */
export interface ReferenceDiag {
  /** Files half unavailable (missing namespace / failed RPC). */
  files?: { code?: string }
  /** Sessions half unavailable (missing namespace / failed RPC). */
  sessions?: { code?: string }
  /** Malformed candidates skipped by the row guard (never crashes the menu). */
  skipped?: number
}

/** The bridge result: the renderable rows plus why a half is missing. */
export interface ReferenceMenuResult {
  rows: readonly ReferenceRow[]
  diag: ReferenceDiag
}

/** The official envelope of either Remote call (structural, no SDK). */
type DomainEnvelope<T> =
  | { ok: true; value: readonly T[] }
  | { ok: false; error: unknown }

/** One half of the official discovery: its rows, or the reason it produced
 *  none. `code` is the host envelope's error code when one was carried. */
type DomainOutcome<T> =
  | { ok: true; items: readonly T[] }
  | { ok: false; code?: string }

/** Resolve ONE discovery half in isolation: a missing face, a rejected RPC
 *  and a host error envelope all degrade to `{ok:false}` — the other half
 *  and the caller never see a throw (the official per-domain guarantee). */
async function domainOf<T>(
  face: ((sessionId: string, query: string, signal: AbortSignal) => Promise<DomainEnvelope<T>>) | undefined,
  sessionId: string,
  query: string,
  signal: AbortSignal,
): Promise<DomainOutcome<T>> {
  if (face === undefined) return { ok: false }
  try {
    const result = await face(sessionId, query, signal)
    if (result.ok) return { ok: true, items: result.value }
    const error = result.error
    const code = typeof error === 'object' && error !== null
      && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined
    return code !== undefined ? { ok: false, code } : { ok: false }
  } catch {
    return { ok: false }
  }
}

/** One file candidate rendered as a menu row (official grammar + copy). */
function fileRow(candidate: ReferenceFileCandidate, preserveQuote: boolean): ReferenceRow[] {
  const mention = formatFileMention(candidate, preserveQuote)
  if (mention === undefined) return []
  const name = candidate.path.slice(candidate.path.lastIndexOf('/') + 1)
  const directory = candidate.kind === 'directory'
  return [{
    section: 'files',
    name: `${t(directory ? 'ref.candidate.folder' : 'ref.candidate.file')} · ${name}${directory ? '/' : ''}`,
    description: candidate.path,
    key: `file:${candidate.path}`,
    insert: mention,
    ...directory ? { continue: true } : {},
  }]
}

/** The official description date: `createdAt` is Unix epoch milliseconds
 *  (the session-reference contract). A missing or malformed value simply
 *  omits the date — one bad candidate must never take the menu down. */
function safeCreatedAt(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    try { return new Date(value).toISOString() } catch { return undefined }
  }
  if (typeof value === 'string') {
    const time = Date.parse(value)
    if (Number.isFinite(time)) {
      try { return new Date(time).toISOString() } catch { return undefined }
    }
  }
  return undefined
}

/** One session candidate rendered as a menu row (the host pre-serialized
 *  canonical `@[label](dsh-session:…)` mention rides verbatim). */
function sessionRow(candidate: ReferenceSessionCandidate): ReferenceRow {
  const location = candidate.cwd ?? t('ref.candidate.noCwd')
  const date = safeCreatedAt(candidate.createdAt)
  const description = `${candidate.label === candidate.sessionId ? '' : `${candidate.sessionId} · `}${location}${date !== undefined ? ` · ${date}` : ''}`
  return {
    section: 'sessions',
    name: `${t('ref.candidate.session')} · ${candidate.label}`,
    description,
    key: `session:${candidate.sessionId}`,
    insert: candidate.mention,
  }
}

/**
 * Fetch the official candidates for one '@' token. Files always run; session
 * discovery is suppressed inside an open quoted path (`@"…`), exactly like
 * the official source. The two halves resolve independently (the official
 * per-domain failure guarantee) and this function NEVER rejects.
 */
export async function listReferenceRows(
  bridge: ReferenceRemoteFace | undefined,
  sessionId: string,
  query: string,
  quoted: boolean,
  signal: AbortSignal,
): Promise<ReferenceMenuResult> {
  if (bridge === undefined) return { rows: [], diag: {} }
  const [fileSide, sessionSide] = await Promise.all([
    domainOf(
      bridge.fileReferences !== undefined
        ? bridge.fileReferences.list.bind(bridge.fileReferences)
        : undefined,
      sessionId,
      query,
      signal,
    ),
    quoted
      ? Promise.resolve({ ok: true as const, items: [] as readonly ReferenceSessionCandidate[] })
      : domainOf(
        bridge.sessionReferenceResolver !== undefined
          ? bridge.sessionReferenceResolver.candidates.bind(bridge.sessionReferenceResolver)
          : undefined,
        sessionId,
        query,
        signal,
      ),
  ])
  if (signal.aborted) return { rows: [], diag: {} }
  const diag: ReferenceDiag = {}
  if (!fileSide.ok) diag.files = fileSide.code !== undefined ? { code: fileSide.code } : {}
  if (!sessionSide.ok) diag.sessions = sessionSide.code !== undefined ? { code: sessionSide.code } : {}
  const rows: ReferenceRow[] = []
  let skipped = 0
  if (fileSide.ok) {
    for (const candidate of fileSide.items) {
      try {
        rows.push(...fileRow(candidate, quoted))
      } catch {
        skipped += 1
      }
    }
  }
  if (sessionSide.ok) {
    for (const candidate of sessionSide.items) {
      try {
        rows.push(sessionRow(candidate))
      } catch {
        skipped += 1
      }
    }
  }
  if (skipped > 0) diag.skipped = skipped
  return { rows, diag }
}