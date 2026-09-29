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
import { itemSlicesOf, triageLinesOf, type ItemFlag, type ItemSlice, type ItemStatusView } from '../../../core/item-view.ts'
import type { ItemRecord } from '../../../core/item.ts'
import { itemRefOf } from '../../../core/item-view.ts'
import { itemTitleOf } from '../../../core/item.ts'
import { t } from '../../locales.ts'
import { itemsArchive, itemsRestore, type ArchiveReply } from '../../items-archive.ts'
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
  const [archiveNote, setArchiveNote] = useState<string | undefined>(undefined)

  const slices = itemSlicesOf(items, { query, ctx: props.matchCtx, sort: prefs.sort, includeDone: prefs.showDone })
  const triage = triageLinesOf(items, now)

  const openArchive = useCallback(async () => {
    setArchive({ kind: 'loading' })
    const reply: ArchiveReply = await itemsArchive()
    setArchive(reply.ok ? { kind: 'ready', rows: reply.deleted } : { kind: 'unreadable' })
  }, [])

  const restoreOne = useCallback(async (item: ItemRecord) => {
    if (props.clientId === undefined) {
      setArchiveNote(t('item.archive.refused', { ref: `#${item.ref}`, why: 'hostUnavailable' }))
      return
    }
    setArchiveNote(undefined)
    setRestoring(item.ref)
    const reply = await itemsRestore({ ref: item.ref }, props.clientId)
    setRestoring(undefined)
    setArchiveNote(reply.ok && reply.restored !== undefined
      ? t('item.archive.restored', { ref: `#${item.ref}` })
      : t('item.archive.refused', { ref: `#${item.ref}`, why: reply.ok ? 'gone' : reply.why }))
    if (reply.ok) await openArchive()
  }, [openArchive, props.clientId])

  const groups = (runs: readonly ItemSlice[]) => runs.map(slice => {
    const folded = prefs.collapsed.includes(slice.status)
    const ratio = slice.progress === undefined || slice.progress.total === 0
      ? 0
      : slice.progress.done / slice.progress.total
    return (
      <section key={slice.status} className={css.itemGroup}>
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
          {folded || slice.items.length === 0 ? null : <ul className={css.itemList}>{props.renderRows(slice.items)}</ul>}
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
          <div className={css.itemTriageRow}>
            <span className={css.itemTriageText}>{t('item.archive.window')}</span>
            <Button
              variant="ghost"
              size="sm"
              className={css.itemTriageAction}
              onClick={() => { setArchiveNote(undefined); void openArchive() }}
            >
              {t('item.archive.open')}
            </Button>
          </div>
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
              {archiveNote !== undefined && <p className={css.itemState} role="status">{archiveNote}</p>}
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
