/**
 * How the model's work reads in the conversation.
 *
 * THE POINT OF THIS FILE. With zero confirmation, "the person can see what
 * just happened" is not a nicety — it is the only thing standing between a
 * quiet mistake and a wrong belief. So the one tool that changes data renders
 * as a sentence in the reader's language, with every affected note named, and
 * two facts kept strictly apart: **a rehearsal wrote nothing**, and **an
 * accepted hand-off has not run yet**.
 *
 * The other two tools are PLUMBING — a lookup and a capability question. They
 * are the model's private bookkeeping, and a card saying
 * `taskboard_capabilities` in the transcript teaches the reader a vocabulary
 * they never asked for. So they render NOTHING. That is the rule: a card is
 * something the person might want to read, and a lookup is not.
 *
 * Everything rendered here comes from `presentationMeta`, which the tool
 * definition computes and the host persists on the result. This file invents
 * nothing: a field it cannot read is simply not shown, because a summary that
 * guesses is the same defect as one that lies.
 */
import { useState } from 'react'
import { t, type TaskBoardKey } from '../locales.ts'
import { Button, Icon } from '../board/ui.tsx'
import css from '../board.module.css'

/** The tool names this plugin contributes, spelled as they travel on the wire. */
const EXECUTE_TOOL = 'taskboard_execute'
const PLUMBING_TOOLS = ['taskboard_capabilities', 'taskboard_query']

/** What the host hands a tool-call view; declared by hand, like every other face. */
interface ToolCallViewProps {
  readonly toolName: string
  /** `result` is the only phase with anything to show. */
  readonly phase: 'preparing' | 'start' | 'result'
  readonly block: { readonly meta?: unknown }
  readonly useDisclosure: () => { readonly open: boolean; readonly toggle: () => void }
}

/** One operation, as the tool reported it back. */
interface OpReport {
  readonly op: string
  readonly ok: boolean
  readonly kind: OpKind
  readonly ref?: string
  readonly title?: string
  readonly detail: string
}

/** The classifications, spelled as the catalog's verb comes back. */
type OpKind = 'created' | 'updated' | 'moved' | 'deleted' | 'unchanged' | 'failed' | 'skipped'

/**
 * THE FIELDS THIS CARD READS.
 *
 * Named in one place because "the field is absent, so the line is not drawn"
 * is exactly how a TYPO becomes a silently empty card instead of a red
 * build — the same disease the `as TaskBoardKey` cast had: a checker that has
 * been told to stay quiet. `tests/item-panel.spec.ts` scans the producer's
 * source and fails if any name here is gone, so a rename upstream breaks a
 * test instead of quietly emptying a card mid-conversation.
 *
 * Verbatim from the producer (`src/host/agent/tools.ts`, `presentationOf`):
 * `dryRun` `persisted` `ok` `summary` `counts` `items` `tasks`
 * `enginePending` `reports`.
 */
export const PRESENTATION_FIELDS = [
  'dryRun', 'persisted', 'ok', 'summary', 'counts', 'items', 'tasks', 'enginePending', 'reports',
] as const

/** The tool's own vocabulary, persisted on the result. */
interface ExecutePresentation {
  readonly dryRun: boolean
  /** Independent of `dryRun` on purpose: the card must be able to say "written"
      and "not written" without re-deriving one from the other. */
  readonly persisted: boolean
  readonly ok: boolean
  readonly summary: string
  /** Per-verb counts, in the catalog's own classification. The headline is
      built from THIS and not from re-counting the reports: two counts that
      disagree are a bug either way, and the tool is the one that knows. */
  readonly counts: Readonly<Record<OpKind, number>>
  /** The rows that moved. The reports below already name them one by one, and
      this card does not draw a second list of the same thing. */
  readonly items: readonly { readonly ref: string; readonly title: string }[]
  /** Board cards carry no short number, so this one answers with a title. */
  readonly tasks: readonly { readonly title: string; readonly status: string }[]
  readonly enginePending: boolean
  readonly reports: readonly OpReport[]
}

const KIND_KEYS: Readonly<Record<OpKind, TaskBoardKey>> = {
  created: 'toolOp.created',
  updated: 'toolOp.updated',
  moved: 'toolOp.moved',
  deleted: 'toolOp.deleted',
  unchanged: 'toolOp.unchanged',
  failed: 'toolOp.failed',
  skipped: 'toolOp.skipped',
}

/** The words a kind gets, in the order a reader wants to hear them. */
const KIND_ORDER: readonly OpKind[] = ['created', 'updated', 'moved', 'deleted', 'failed', 'skipped', 'unchanged']

/**
 * One line built from the counts, skipping the zeroes.
 *
 * A rehearsal and a real run are announced the same way ON PURPOSE: what
 * changed comes first, and whether anything was WRITTEN is the line under it.
 * Leading with "nothing was written" would make a rehearsal unreadable;
 * leading with "added 3" would make it a lie.
 */
function headlineOf(counts: ExecutePresentation['counts']): string {
  const parts = KIND_ORDER
    .filter(kind => (counts[kind] ?? 0) > 0)
    .map(kind => `${t(KIND_KEYS[kind])} ${String(counts[kind])}`)
  return parts.length === 0 ? t('toolOp.nothing') : parts.join(' · ')
}

/**
 * Register the tool-call views this plugin owns.
 *
 * Keyed by the WIRE tool name — the contract says a keyed hit replaces the
 * generic row, and a name that is not in flight simply never renders (so a
 * typo is a missing card, not a crash). Nothing here is registered for the
 * plumbing tools beyond returning nothing.
 * @param register - the slot's register function, read by the caller.
 * @returns a disposer removing every entry.
 */
export function registerToolViews(
  register: (slot: string, key: string, component: unknown) => () => void,
  namespace: string,
): () => void {
  const disposers: (() => void)[] = []
  for (const name of PLUMBING_TOOLS) {
    disposers.push(register('tool.call.toolview', name, PlumbingRow))
  }
  disposers.push(register('tool.call.toolview', EXECUTE_TOOL, ExecuteRow))
  void namespace
  return () => {
    for (let i = disposers.length - 1; i >= 0; i -= 1) disposers[i]()
    disposers.length = 0
  }
}

/** A lookup. Nothing to say to a person about a lookup. */
function PlumbingRow() {
  return null
}

/**
 * The batch the model just ran.
 * @param props - the host's call props.
 * @returns one line of plain language, plus the operations behind it.
 */
function ExecuteRow(props: ToolCallViewProps) {
  const { phase, block } = props
  const disclosure = props.useDisclosure()
  if (phase !== 'result') return null
  const meta = block.meta as ExecutePresentation | undefined
  if (meta === undefined) return null
  const reports = meta.reports ?? []
  // The headline is the COUNTS, so it says what happened in the tool's own
  // classification rather than a hand-written summary of it.
  const headline = headlineOf(meta.counts)
  // Written vs not-written is a separate sentence, never inferred from the
  // headline: a rehearsal that reads "added 3" has told the reader something
  // was written that was not.
  const wrote = meta.persisted === true
  const rehearsing = meta.dryRun === true
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? reports : reports.slice(0, 3)

  return (
    <div className={css.toolCard} data-ok={meta.ok ? '' : undefined} data-dry={rehearsing ? '' : undefined}>
      <p className={css.toolCardHeadline}>
        <Icon name={meta.ok ? 'checklist' : 'close'} className={css.toolCardIcon} />
        {rehearsing ? t('toolCard.rehearsed', { what: headline }) : headline}
      </p>
      {meta.summary !== '' && (
        <p className={css.toolCardSummary}>{meta.summary}</p>
      )}
      {rehearsing && <p className={css.toolCardNote}>{t('toolCard.dryRunNote')}</p>}
      {!rehearsing && !wrote && <p className={css.toolCardNote}>{t('toolCard.notWrittenNote')}</p>}
      {/* Accepted is not executed. Drawing these as done is the exact lie the
          tool definition went out of its way to avoid. */}
      {!rehearsing && meta.enginePending === true && (
        <p className={css.toolCardNote}>{t('toolCard.enginePendingNote')}</p>
      )}
      {visible.length > 0 && (
        <ul className={css.toolCardOps}>
          {visible.map((report, index) => (
            <li key={`${report.op}-${index}`} data-kind={report.kind} data-ok={report.ok ? '' : undefined}>
              <span className={css.toolCardOpKind}>{t(KIND_KEYS[report.kind])}</span>
              {report.ref !== undefined && <span className={css.toolCardOpRef}>{report.ref}</span>}
              {report.title !== undefined && report.title !== '' && (
                <span className={css.toolCardOpTitle}>{report.title}</span>
              )}
              <span className={css.toolCardOpDetail}>{report.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {reports.length > 3 && (
        <Button
          variant="ghost"
          size="sm"
          pressed={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? t('toolCard.less') : t('toolCard.more', { n: String(reports.length - 3) })}
        </Button>
      )}
      {meta.dryRun !== true && meta.enginePending === true && (
        <button type="button" className={css.toolCardMore} onClick={disclosure.toggle}>
          {disclosure.open ? t('toolCard.less') : t('toolCard.detail')}
        </button>
      )}
    </div>
  )
}
