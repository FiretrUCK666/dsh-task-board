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
import { itemSlicesOf, triageLinesOf, type ItemSlice } from '../../../core/item-view.ts'
import type { ItemRecord } from '../../../core/item.ts'
import { itemRefOf } from '../../../core/item-view.ts'
import { itemTitleOf } from '../../../core/item.ts'
import { t } from '../../locales.ts'
import { toggleCollapsed } from '../view-prefs.ts'
import { itemsArchive, itemsRestore, type ArchiveReply } from '../../items-archive.ts'
import { whyLabelOf } from '../why-label.ts'
import { Button } from '../../board/ui.tsx'
import { ItemStateBar } from '../state-bar.tsx'
import { GROUP_LABEL, TRIAGE_SHORT } from '../labels.ts'
import { isFacetOn, withFacetToken } from '../facets.ts'
import type { ItemPageProps } from './page-props.ts'
import css from '../item.module.css'

/** The list page's own two additions: nothing but the device's id. */
export interface ItemListPageProps extends ItemPageProps {
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

  // THE FINISHED GROUP IS ALWAYS HERE, and the reader's way to put it away is the
  // group's own fold — a visible control, a drawn arrow, and per-group memory.
  // `includeDone` used to be a page-level switch written by a control on a strip
  // that is retired, so a device that had stored it off could never turn it back
  // on: **a preference whose control is gone is not a setting, it is a trap with
  // the handle filed off.** One intent, one control.
  const slices = itemSlicesOf(items, { query, ctx: props.matchCtx, sort: prefs.sort, includeDone: true })
  const triage = triageLinesOf(items, now)

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

  /**
   * THE GROUPS, and the empty ones share one line.
   *
   * Measured on a 1600px board: three empty buckets cost 201px of the first
   * screen, and every one of those 67px blocks held a name, a number and no rows.
   * A 折叠 is one of the four moves hard rule 11 allows, and this is that move
   * applied to CONTENT rather than to a control — **nothing is hidden and nothing
   * is removed**: each bucket keeps its name, keeps its count, and stays a button
   * that filters to it exactly as the group head does. What changes is that
   * consecutive empty buckets stand shoulder to shoulder instead of each taking
   * a block and the air around it.
   *
   * ONLY *CONSECUTIVE* EMPTIES SHARE A LINE. A bucket with rows in it is a
   * heading with content under it, and it separates the runs — so the reader's
   * eye still gets a full block where there is something to read, and the air
   * is spent only where there is not.
   *
   * AND AN ENTIRELY EMPTY DOCUMENT IS NOT A ROW OF ZEROS. A list that holds
   * nothing has no groups to compress, and 「进行中 0 · 受阻 0 · 已完成 0」 would be
   * a document-shaped answer to a question about work. That case keeps the one
   * sentence, which says the useful thing.
   *
   * AT THE END, WITH THE ARCHIVE, and the reason is that the summary was answering
   * the wrong question at the wrong moment. 「Which buckets are empty」 is what a
   * reader asks when a row they expected is NOT on screen — it is an answer to a
   * failed search, not a preface to reading. At the top of the page it spent 110px
   * (38 of it words, 72 of it air) to say three facts about buckets before the
   * reader had seen a single row of the one bucket they came for, and the ratio of
   * air to ink was the worst on the surface. Beside the archive it is what it
   * always was: 「the accounts of this page」, both about things that are not on
   * this page.
   *
   * Nothing is lost by the move. Every empty bucket keeps its name, its count and
   * its filter, in the same place a reader would go looking for 「where did it
   * go」 — which is the bottom of the page.
   */
  const emptyRuns: ItemSlice[][] = []
  const groups = (runs: readonly ItemSlice[]) => {
    const out: React.ReactNode[] = []
    let empties: readonly ItemSlice[] = []
    const flush = (): void => {
      if (empties.length === 0) return
      emptyRuns.push([...empties])
      empties = []
    }
    for (const slice of runs) {
      if (slice.items.length === 0) { empties = [...empties, slice]; continue }
      flush()
      out.push(group(slice))
    }
    flush()
    return out
  }

  /** One bucket with rows in it, which is the shape that keeps a whole block. */
  const group = (slice: ItemSlice) => {
    const folded = prefs.collapsed.includes(slice.status)
    return (
      <section key={slice.status} className={css.itemGroup}>
        <h2 className={css.itemGroupHead}>
          <button
            type="button"
            className={css.itemGroupToggle}
            aria-expanded={!folded}
            aria-controls={`item-group-${slice.status}`}
            onClick={() => choose({ collapsed: toggleCollapsed(prefs.collapsed, slice.status) })}
          >
            {/* The fold indicator is DRAWN; see `.itemGroupChevron`. It was the
                text character `›`, which paired with the board's rotation copied
                for a glyph pointing the other way made the two states read
                backwards. */}
            <span className={css.itemGroupChevron} aria-hidden="true" />
            {t(GROUP_LABEL[slice.status])}
            <span className={css.itemGroupCount}>{slice.items.length}</span>
          </button>
          {/* NO METER BESIDE THE COUNT, and the count is now the whole of the
              group's arithmetic. A 2px accent bar is one of the few saturated
              marks on this surface and the budget for them is small; four group
              bars under four group heads spends four of them restating a number
              the reader is already looking at, in the one place on the page they
              are most likely to stop reading. A group that has steps says so on
              its own rows, which is where a reader looks to find out. */}
        </h2>
        <div className={css.itemGroupList} id={`item-group-${slice.status}`}>
          {/* An empty group keeps its HEAD — the reader's map, and a group that
              vanishes the moment it empties reads as a broken filter rather than
              an empty queue. It does NOT get a second sentence: the count `0` has
              already said it, and saying it again in lighter ink turns one fact
              into something that looks like data. */}
          {folded ? null : <ul className={css.itemList}>{props.renderRows(slice.items, props.picking)}</ul>}
        </div>
      </section>
    )
  }

  /**
   * WHICH OF TWO FACTS IS TRUE, decided by the DOCUMENT rather than by whether a
   * filter happens to be typed.
   *
   * 「Nothing here」 and 「nothing here matched」 look identical on screen, and
   * they point at opposite repairs: one is fixed by writing something, the other
   * by clearing a filter. Deciding it on `filtering` alone gets it backwards in
   * the state a new reader is actually in — an empty document with a search box
   * already holding a word says 「没有匹配的结果。清空搜索或换个筛选看看。」, which
   * invites a reader to clear a search that was never what emptied the page.
   */
  const nothingToShow = items.length === 0 ? t('item.empty') : t('item.noMatch')

  /**
   * THE ARCHIVE LINE, and it is the LAST thing on the page.
   *
   * A capture-first surface lives or dies on 「我没有刚弄丢」, so the way back is
   * announced rather than hidden behind a menu nobody opens — and it states the
   * window instead of implying it, because a restore button that has quietly
   * stopped working is worse than one that never appeared. It is a DERIVED page:
   * it does not occupy the rail, because a rail that grows an entry every time
   * the reader asks a question turns a map into a log.
   *
   * AT THE END, and the reason is a measurement rather than a preference: it was
   * drawn above the first row, where a reader who has just captured a thought
   * has to look past a thirty-day retention window to reach their own work. The
   * delete receipt already states the window at the moment it matters — which is
   * the moment the reader might want it — so the standing announcement is a
   * duplicate of a thing they have just been told, sitting above the thing they
   * came for.
   *
   * PM flagged this as the one decision in the round that makes an entrance WEAKER
   * rather than quieter, and that is true. What keeps it honest: nothing is
   * removed, the window is still stated, and the entry is still a single press
   * below everything else on the page.
   */
  const archiveLine = archive === undefined
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
            {/* A COUNT ONLY WHERE THERE IS ONE TO COUNT. It used to print `0` in
                every state but `ready`, so an archive the host could not be reached
                for showed the same number as an archive that is genuinely empty —
                and the sentence under it says the opposite of what the number
                implies. The whole reason this block is a page of its own is that
                「读不到」 must never be drawn as 「空」; the number was undoing that in
                the corner nobody looks at. */}
            {archive.kind === 'ready' && <span className={css.itemGroupCount}>{archive.rows.length}</span>}
          </button>
        </h2>
        <div className={css.itemGroupList}>
          {/* The SENTENCE is what the reader reads; the raw code is the `title`, so
              the host's own vocabulary is one hover away for whoever has to
              diagnose it and invisible to everyone else. */}
          {archiveNote !== undefined && <p className={css.itemState} role="status" title={archiveNote.raw}>{archiveNote.words}</p>}
          {archive.kind === 'loading' && <p className={css.itemState} role="status">{t('item.loading')}</p>}
          {/* NOT REACHABLE IS NOT EMPTY. Saying 「你没有删过任何一条」 when the host
              was simply never reached would tell the reader their deletions are
              gone when they may be sitting on the disk. */}
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
    )

  return (
    <>
      {/* THE ANSWER COMES FIRST, then the machinery. A reader who has narrowed
          the list should be able to read WHAT is on without opening the panel
          that holds it — so the state bar is the first thing on the page and the
          filter bar is the thing that explains itself when asked. */}
      <ItemStateBar
        query={query}
        tags={items.map(item => item.tags)}
        sort={prefs.sort}
        onSort={next => choose({ sort: next })}
        onClear={() => choose({ search: '' })}
      />
      {props.batch}
      {/* NO FILTER BAR IN THE LIST. The search box, the four facet faces and the
          six orders all live in the command palette, and a second copy of each on
          the page is a control the reader has to reconcile rather than one they
          have to learn: the same four faces, the same six orders, drawn twice, and
          nothing on screen saying they are the same thing.

          The batch door went with it, and that is the one removal here that is not
          purely de-duplication — so it went somewhere rather than nowhere. `X` on a
          row still picks, and 「多选」 and 「全选」 are actions in the palette, which
          is the same place every other thing you can ask for already is. A reader
          with a mouse can still reach the batch; they reach it by asking, not by
          spotting a control. */}
      {triage.length === 0
        ? <p className={css.itemTriageText}>{t('item.triage.nothing')}</p>
        : (
          /* ONE LINE, IN BOTH BANDS, and this is the same move as the empty-group
             compression: 让位, not hiding.

             It was four sentences, one per line, each with a 「去看」 button at its
             right end — 155px standing between the reader and their first row. The
             buttons were four identical controls pointing at four different
             sentences that were themselves clickable, so they carried no
             information a reader did not already have one press away.

             What is left is every number, and each is still a filter: the same
             `withFacetToken` writer the group head and the empty-group summary use,
             so pressing 「1 卡住」 puts `has:blocked` into the one query the whole
             surface reads. The counts are not decoration and they are not a
             summary — they are the four filters, drawn as four words.

             BOTH BANDS, and that is the deliberate part. A reader on a phone
             folded this and a reader at a desk did not, which made the same four
             facts two different shapes depending on how much room the reader had,
             and 「the phone is offered what the desk is offered」 stops being true
             the moment a control changes shape by band. */
          <div className={css.itemTriage} aria-label={t('item.triage.title')}>
            <h3 className={css.itemSectionTitle}>{t('item.triage.title')}</h3>
            <p className={css.itemTriageText}>
              <span>{t('item.triage.folded', { n: String(triage.reduce((sum, line) => sum + line.count, 0)) })}</span>
              {triage.map(line => (
                <span key={line.id}>
                  {' · '}
                  <button
                    type="button"
                    className={css.itemTriageAction}
                    aria-pressed={isFacetOn(query, 'date', line.id)}
                    onClick={() => choose({ search: withFacetToken(query.text, `has:${line.id}`, !isFacetOn(query, 'date', line.id)) })}
                  >
                    {t(TRIAGE_SHORT[line.id], { n: String(line.count) })}
                  </button>
                </span>
              ))}
            </p>
          </div>
        )}

      {items.length === 0 || (props.filtering && slices.every(run => run.items.length === 0))
        ? <p className={css.itemState}>{nothingToShow}</p>
        : groups(slices)}

      {/* THE ACCOUNTS OF THIS PAGE, last: which buckets are empty, and the way
          back to what was deleted. Both are answers to a reader who is looking
          for something and not finding it, which is why neither is above the
          rows. */}
      {emptyRuns.map(run => (
        <div key={`empty-${run.map(slice => slice.status).join('-')}`} className={css.itemEmptyGroups} role="group">
          {/* The separator is a SIBLING of the buttons, not a wrapper around them.
              A wrapper would have needed a class of its own, and a class that
              exists only to hold a middot is a class the stylesheet has to be told
              about for the sake of one glyph. */}
          {run.map((slice, at) => (
            <span key={slice.status} style={{ display: 'contents' }}>
              {at > 0 && <span className={css.itemEmptyGroupSep} aria-hidden="true">·</span>}
              <button
                type="button"
                className={css.itemEmptyGroup}
                data-status={slice.status}
                aria-pressed={isFacetOn(query, 'status', slice.status)}
                onClick={() => choose({ search: withFacetToken(query.text, `status:${slice.status}`, !isFacetOn(query, 'status', slice.status)) })}
              >
                {t(GROUP_LABEL[slice.status])}
                <span className={css.itemEmptyGroupCount}>{slice.items.length}</span>
              </button>
            </span>
          ))}
        </div>
      ))}
      {archiveLine}
    </>
  )
}
