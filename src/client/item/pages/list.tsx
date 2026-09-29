/**
 * The list page: the workbench. Its centre, its controls, then its rows.
 *
 * THE ORDER OF THE THREE IS THE ORDER OF THE EYE. How the work stands (the
 * overview strip), how I am looking at it (the filter bar), what it is (the
 * groups). Putting the controls first would answer 「what can I do here」 before
 * 「how am I doing」, and a page that opens with its own toolbar is a page whose
 * first impression is a set of buttons.
 *
 * THE TRIAGE STRIP IS A PARAGRAPH, NOT A CONTAINER. It was a bordered, rounded
 * panel with a coloured bar down the side of every line — a frame inside a
 * frame around two lines of text, competing with the rows it exists to outrank.
 * What replaced it is a sentence with a verb at the end of it, and the reason is
 * that nothing here is an independent thing: it is this page's summary, written
 * above the list and pointing into it. Boxing it says 「this is separate from
 * those rows」, and it is not.
 *
 * THE ARCHIVE LIVES HERE AND ITS STATE LIVES HERE TOO. It is a list-page entry —
 * a derived page the reader arrives at, not a destination on the rail — and it is
 * the only thing on the surface with three states instead of two, so all three of
 * them are local to this file: reading, READ-UNREACHABLE, and empty. The third is
 * the one that matters, and 「unreachable」 must never be drawn as 「empty」: that
 * would tell a reader their deletions are gone when they may be sitting on disk.
 */
import { useCallback, useState } from 'react'
import { Disclosure } from '../../board/ui.tsx'
import { itemSlicesOf, triageLinesOf, type ItemFlag, type ItemSlice, type ItemStatusView } from '../../../core/item-view.ts'
import type { ItemRecord } from '../../../core/item.ts'
import { itemRefOf } from '../../../core/item-view.ts'
import { itemTitleOf } from '../../../core/item.ts'
import { t } from '../../locales.ts'
import { itemsArchive, itemsRestore, type ArchiveReply } from '../../items-archive.ts'
import { whyLabelOf } from '../why-label.ts'
import { Button } from '../../board/ui.tsx'
import { ItemFilterBar } from '../filter-bar.tsx'
import { ItemInsightStrip } from '../insight-strip.tsx'
import { GROUP_LABEL, TRIAGE_LABEL, type ItemPageProps } from './page-props.ts'
import css from '../item.module.css'

/** The four group counts, plus the list total. Read by the strip, not derived
 *  here: this page must not be the place that decides what the numbers are. */
export interface ItemListPageProps extends ItemPageProps {
  readonly counts: Readonly<Record<ItemStatusView, number>>
  /** This device's id, which every host write on this prefix carries. */
  readonly clientId: string | undefined
}

type ArchiveState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly rows: readonly ItemRecord[] }
  | { readonly kind: 'unreadable' }
  | undefined

export function ListPage(props: ItemListPageProps) {
  const { items, now, query, prefs, choose } = props
  const [archive, setArchive] = useState<ArchiveState>(undefined)
  const [restoring, setRestoring] = useState<number | undefined>(undefined)
  const [archiveNote, setNote] = useState<{ readonly words: string; readonly raw: string } | undefined>(undefined)
  /** One way to write the note, so 「clear it」 and 「say a code」 cannot disagree. */
  const setArchiveNote = useCallback((note: string | undefined, raw = note ?? '') => {
    setNote(note === undefined ? undefined : { words: note, raw })
  }, [])

  const slices = itemSlicesOf(items, { query, ctx: props.matchCtx, sort: prefs.sort, includeDone: prefs.showDone })
  const triage = triageLinesOf(items, now)
  const [triageOpen, setTriageOpen] = useState(false)

  const openArchive = useCallback(async () => {
    setArchive({ kind: 'loading' })
    const reply: ArchiveReply = await itemsArchive()
    setArchive(reply.ok ? { kind: 'ready', rows: reply.deleted } : { kind: 'unreadable' })
  }, [])

  /**
   * Restore one archived row, ADDRESSED BY ITS IDENTITY.
   *
   * It used to address by short number, and that made a row deleted before the
   * document numbered it impossible to get back: the archive holds whole rows, a
   * row written seconds ago carries no number yet, the host refuses a number of
   * zero as a name, and the button was permanently dead on exactly the rows a
   * reader is most likely to want back. The receipt also printed `#0` — the
   * sentinel `itemRefOf` exists to keep off the screen.
   *
   * So the archive uses the name it is HOLDING. The short number stays the model's
   * name, because a number is the thing a person and a model say out loud and the
   * model only ever reads rows the document has already numbered; a reader reading
   * the archive has the row in front of them and its identity with it.
   */
  const restoreOne = useCallback(async (item: ItemRecord) => {
    // The label carries its own `#`, which is why the sentence does not add one:
    // it used to, and a row numbered 9 read 「没能找回 ##9」. One place decides
    // how a row is written, and that place is `itemRefOf`.
    const label = itemRefOf(item).text ?? '—'
    if (props.clientId === undefined) {
      const why = whyLabelOf('hostUnavailable')
      setArchiveNote(t('item.archive.refused', { ref: label, why: why.words }), why.raw)
      return
    }
    setArchiveNote(undefined)
    setRestoring(item.ref)
    const reply = await itemsRestore({ id: item.id }, props.clientId)
    setRestoring(undefined)
    // A CODE, said as a sentence. The raw one is what the host and the transport
    // speak; the reader gets a reason they can act on, and the code itself goes
    // into the note's title for whoever has to diagnose it.
    const why = whyLabelOf(reply.ok ? 'gone' : reply.why)
    setArchiveNote(reply.ok && reply.restored !== undefined
      ? t('item.archive.restored', { ref: label })
      : t('item.archive.refused', { ref: label, why: why.words }), why.raw)
    if (reply.ok) await openArchive()
  }, [openArchive, props.clientId])

  const groups = (runs: readonly ItemSlice[]) => runs.map(slice => {
    const folded = prefs.collapsed.includes(slice.status)
    const ratio = slice.progress === undefined || slice.progress.total === 0
      ? 0
      : slice.progress.done / slice.progress.total
    return (
      <section key={slice.status} className={css.itemGroup} data-empty={slice.items.length === 0 ? '' : undefined}>
        <h2 className={css.itemGroupHead}>
          <button
            type="button"
            className={css.itemGroupToggle}
            aria-expanded={!folded}
            aria-controls={`item-group-${slice.status}`}
            onClick={() => choose({ collapsed: prefs.collapsed.includes(slice.status) ? prefs.collapsed.filter(g => g !== slice.status) : [...prefs.collapsed, slice.status] })}
          >
            {/* The fold indicator is DRAWN; see `.itemGroupChevron`. It was the
                text character `›`, which paired with the board's rotation copied
                for a glyph pointing the other way made the two states read
                backwards. */}
            <span className={css.itemGroupChevron} aria-hidden="true" />
            {t(GROUP_LABEL[slice.status])}
            <span className={css.itemGroupCount}>{slice.items.length}</span>
          </button>
          {/* The group's own arithmetic, and a 2px bar BESIDE its number rather
              than a rule under the head: at the full group measure a hairline
              under the text reads as an underline of that text, and one that
              appears on some groups and not others reads as a selection. */}
          {slice.progress !== undefined && (
            <p className={css.itemGroupStats}>
              {t('item.groupSteps', { done: String(slice.progress.done), total: String(slice.progress.total) })}
              <span className={css.itemGroupProgress}>
                <span className={css.itemGroupProgressFill} style={{ inlineSize: `${Math.round(ratio * 100)}%` }} />
              </span>
            </p>
          )}
        </h2>
        <div className={css.itemGroupList} id={`item-group-${slice.status}`}>
          {/* An empty group keeps its HEAD — the reader's map, and a group that
              vanishes the moment it empties reads as a broken filter rather than
              an empty queue. It does NOT get a second sentence: the count `0` has
              already said it, and saying it again in lighter ink turns one fact
              into something that looks like data. */}
          {folded || slice.items.length === 0 ? null : <ul className={css.itemList}>{props.renderRows(slice.items, props.picking)}</ul>}
        </div>
      </section>
    )
  })

  const nothingToShow = props.filtering ? t('item.noMatch') : t('item.empty')

  return (
    <>
      <ItemInsightStrip
        items={items}
        counts={props.counts}
        now={now}
        query={query}
        onSearch={next => choose({ search: next })}
        onShowDone={on => choose({ showDone: on })}
        showDone={prefs.showDone}
      />
      <ItemFilterBar
        query={query}
        onSearch={next => choose({ search: next })}
        sort={prefs.sort}
        onSort={next => choose({ sort: next })}
        tags={items.map(item => item.tags)}
        filtering={props.filtering}
        onClear={() => choose({ search: '' })}
        armed={props.armed === true}
        onArm={props.onArm ?? (() => undefined)}
        allPicked={props.allPicked === true}
        onPickAll={props.onPickAll ?? (() => undefined)}
        selectable={props.selectable === true}
      />
      {props.batch}
      {triage.length === 0
        ? <p className={css.itemTriageText}>{t('item.triage.nothing')}</p>
        : props.narrow
          ? (
            /* THE NARROW FOLD, and it is the ONLY place this surface collapses anything.
               Measured on a 390×844 phone: the first group head sat at y=668, so 79%
               of the screen was spent before a single row — and this block was 173px
               of that, four lines of summary standing above the rows they summarise.

               折叠 is one of the four moves hard rule 11 allows (换行 / 换列 / 让位 /
               折叠); hiding the CONTENT would not be, and is not what this does. The
               header carries the COUNTS, so a folded block still says 「1 项过了想要
               的日子 · 1 项卡住了」 — a reader is not deprived of the summary, only
               of the per-line 「去看」 buttons, and one tap brings both back. Nothing
               is removed, nothing is shrunk, and no control disappears: the fold
               IS the control.

               The WIDE band keeps every line open. There is room for it there, and a
               summary that stays folded on a screen with space to show it is a
               control the reader has to pay for with no reason. */
            <div aria-label={t('item.triage.title')}>
            <Disclosure
              title={t('item.triage.title')}
              summary={triage.map(line => t(TRIAGE_LABEL[line.id as ItemFlag] ?? 'item.triage.undated', {
                n: String(line.count),
                days: String(line.worstDays ?? 0),
              })).join(' · ')}
              open={triageOpen}
              onToggle={() => { setTriageOpen(current => !current) }}
            >
              {triage.map(line => (
                <div key={line.id} className={css.itemTriageRow} data-severity={line.severity}>
                  <span className={css.itemTriageText}>
                    {t(TRIAGE_LABEL[line.id as ItemFlag] ?? 'item.triage.undated', {
                      n: String(line.count),
                      days: String(line.worstDays ?? 0),
                    })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={css.itemTriageAction}
                    onClick={() => choose({ search: `has:${line.id}` })}
                  >
                    {t('item.triage.open')}
                  </Button>
                </div>
              ))}
            </Disclosure>
            </div>
          )
          : (
          <div className={css.itemTriage} aria-label={t('item.triage.title')}>
            <h3 className={css.itemSectionTitle}>{t('item.triage.title')}</h3>
            {triage.map(line => (
              <div key={line.id} className={css.itemTriageRow} data-severity={line.severity}>
                <span className={css.itemTriageText}>
                  {t(TRIAGE_LABEL[line.id as ItemFlag] ?? 'item.triage.undated', {
                    n: String(line.count),
                    days: String(line.worstDays ?? 0),
                  })}
                </span>
                {/* A TEXT ACTION, because a pill has an intrinsic width and a
                    flex row puts it wherever the slack is — which put 「去看」
                    660px from the sentence it acts on. No flex value fixes that;
                    the control has to change. */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={css.itemTriageAction}
                  onClick={() => choose({ search: `has:${line.id}` })}
                >
                  {t('item.triage.open')}
                </Button>
              </div>
            ))}
          </div>
        )}

      {/* THE ARCHIVE LINE: a capture-first surface lives or dies on 「我没有刚弄丢」,
          so the way back is announced here rather than hidden behind a menu nobody
          opens — and it states the window instead of implying it, because a restore
          button that has quietly stopped working is worse than one that never
          appeared. It is a DERIVED page: it does not occupy the rail, because a
          rail that grows an entry every time the reader asks a question turns a map
          into a log. */}
      {archive === undefined
        ? (
          /* ITS OWN CLASS, and the reason is spacing rather than naming. This is a
             footnote about the archive — it is not one more thing needing your
             attention — and it was wearing `.itemTriageRow`, which is a row in the
             triage list: that class carries a hairline above itself, the padding of
             a tappable row, and its own hover. So the page drew a divider under the
             triage block, gave a sentence 40px of height, and opened the space
             between two bands to 51px where the rhythm says 12. One class holding
             two unrelated meanings is how a rhythm stops being a rhythm: the number
             that is supposed to describe the page was being spent on a footnote. */
          <p className={css.itemArchiveRow}>
            <span className={css.itemArchiveNote}>{t('item.archive.window')}</span>
            <Button
              variant="ghost"
              size="sm"
              className={css.itemArchiveAction}
              onClick={() => { setArchiveNote(undefined); void openArchive() }}
            >
              {t('item.archive.open')}
            </Button>
          </p>
        )
        : (
          <section className={css.itemGroup}>
            <h2 className={css.itemGroupHead}>
              <button
                type="button"
                className={css.itemGroupToggle}
                onClick={() => { setArchive(undefined); setArchiveNote(undefined) }}
              >
                {t('item.archive.title')}
                <span className={css.itemGroupCount}>{archive.kind === 'ready' ? archive.rows.length : 0}</span>
              </button>
            </h2>
            <div className={css.itemGroupList}>
              {/* The SENTENCE is what the reader reads; the raw code is the
                  `title`, so the host's own vocabulary is one hover away for
                  whoever has to diagnose it and invisible to everyone else. */}
              {archiveNote !== undefined && <p className={css.itemState} role="status" title={archiveNote.raw}>{archiveNote.words}</p>}
              {archive.kind === 'loading' && <p className={css.itemState} role="status">{t('item.loading')}</p>}
              {/* NOT REACHABLE IS NOT EMPTY. Saying 「你没有删过任何一条」 when the
                  host was simply never reached would tell the reader their
                  deletions are gone when they may be sitting on the disk. */}
              {archive.kind === 'unreadable' && <p className={css.itemState} role="status">{t('item.archive.unreadable')}</p>}
              {archive.kind === 'ready' && archive.rows.length === 0 && <p className={css.itemState}>{t('item.archive.empty')}</p>}
              {archive.kind === 'ready' && archive.rows.length > 0 && (
                <ul className={css.itemList}>
                  {archive.rows.map(row => (
                    <li key={row.id} className={css.itemRecentRow}>
                      <span className={css.itemRef}>{itemRefOf(row).text ?? '—'}</span>
                      <span className={css.itemTitle}><span className={css.itemTitleText}>{itemTitleOf(row)}</span></span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={restoring === row.ref}
                        onClick={() => { void restoreOne(row) }}
                      >
                        {t(restoring === row.ref ? 'item.archive.restoring' : 'item.archive.restore')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <p className={css.itemHint}>{t('item.archive.window')}</p>
              <Button variant="ghost" size="sm" onClick={() => { setArchive(undefined); setArchiveNote(undefined) }}>
                {t('item.archive.close')}
              </Button>
            </div>
          </section>
        )}

      {items.length === 0 || (props.filtering && slices.every(run => run.items.length === 0))
        ? <p className={css.itemState}>{nothingToShow}</p>
        : groups(slices)}
    </>
  )
}
