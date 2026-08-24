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
 * The remote namespaces are structural (`ReferenceRemoteFace` from the core),
 * so absent surfaces degrade to "no @ menu" exactly like a missing slash
 * catalog — never a broken menu.
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

/** One session candidate rendered as a menu row (the host pre-serialized
 *  canonical `@[label](dsh-session:…)` mention rides verbatim). */
function sessionRow(candidate: ReferenceSessionCandidate): ReferenceRow {
  const location = candidate.cwd ?? t('ref.candidate.noCwd')
  const description = `${candidate.label === candidate.sessionId ? '' : `${candidate.sessionId} · `}${location} · ${new Date(candidate.createdAt).toISOString()}`
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
 * the official source. A missing/failing namespace degrades to its empty
 * half (the official catch → [] policy); the abort signal cancels the pair.
 */
export async function listReferenceRows(
  bridge: ReferenceRemoteFace | undefined,
  sessionId: string,
  query: string,
  quoted: boolean,
  signal: AbortSignal,
): Promise<readonly ReferenceRow[]> {
  if (bridge === undefined) return []
  const files = bridge.fileReferences !== undefined
    ? bridge.fileReferences.list(sessionId, query, signal).then(
      result => result.ok ? result.value : [],
      () => [],
    )
    : Promise.resolve([] as readonly ReferenceFileCandidate[])
  const sessions = !quoted && bridge.sessionReferenceResolver !== undefined
    ? bridge.sessionReferenceResolver.candidates(sessionId, query, signal).then(
      result => result.ok ? result.value : [],
      () => [],
    )
    : Promise.resolve([] as readonly ReferenceSessionCandidate[])
  const [fileItems, sessionItems] = await Promise.all([files, sessions])
  if (signal.aborted) return []
  return [
    ...fileItems.flatMap(candidate => fileRow(candidate, quoted)),
    ...sessionItems.map(sessionRow),
  ]
}