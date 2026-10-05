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
import { itemSlicesOf } from '../../../core/item-view.ts'
import type { ItemRecord } from '../../../core/item.ts'
import { itemRefOf } from '../../../core/item-view.ts'
import { itemTitleOf } from '../../../core/item.ts'
import { t } from '../../locales.ts'
import { itemsArchive, itemsPurge, itemsRestore, type ArchiveReply } from '../../items-archive.ts'
import { removeItemRecord } from '../../../core/item-transitions.ts'
import { whyLabelOf } from '../why-label.ts'
import { Button } from '../../board/ui.tsx'
import { ItemTable } from '../item-table.tsx'
import type { ItemPageProps } from './page-props.ts'
import css from '../item.module.css'

/** The list page's own two additions: nothing but the device's id. */
export interface ItemListPageProps extends ItemPageProps {
  /** This device's id, which every host write on this prefix carries. */
  readonly clientId: string | undefined
  /**
   * Whether the finished rows are on the list, and the one way to change it.
   *
   * IT IS HERE AND NOT ON THE SHARED BUNDLE because the switch belongs to THIS
   * page and to no other: the agenda is a sequence of days and the inbox holds
   * rows nobody has filed, so 「隐藏已完成」 on either of them is a question with
   * no answer. It used to be drawn on the filter bar and wired to a `useState`
   * that NOTHING read — the slice was cut with a hard-coded `includeDone: true` —
   * so the control said one thing and the list did the other, which is worse than
   * having no control: the reader unticks it, the finished rows stay, and the
   * natural conclusion is that the panel has lost the rows rather than that the
   * switch is a picture of a switch.
   */
  readonly showDone: boolean
  readonly onShowDone: (next: boolean) => void
}

type ArchiveState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly rows: readonly ItemRecord[] }
  | { readonly kind: 'unreadable' }
  | undefined

export function ListPage(props: ItemListPageProps) {
  const { items, query, prefs } = props
  const [archive, setArchive] = useState<ArchiveState>(undefined)
  const [restoring, setRestoring] = useState<number | undefined>(undefined)
  /**
   * WHICH ARCHIVED ROW IS BEING ERASED, by identity.
   *
   * `restoring` is a number because the reader sees 「#7 正在找回」 and a number
   * is what the archive shows next to every row; the erase has no number to
   * disable against, because a number can be reused between the press and the
   * answer and disabling `#7` then would grey out somebody else's row.
   */
  const [purging, setPurging] = useState<string | undefined>(undefined)
  const [archiveNote, setNote] = useState<{ readonly words: string; readonly raw: string } | undefined>(undefined)
  /** One way to write the note, so 「clear it」 and 「say a code」 cannot disagree. */
  const setArchiveNote = useCallback((note: string | undefined, raw = note ?? '') => {
    setNote(note === undefined ? undefined : { words: note, raw })
  }, [])

  // 已完成是一个开关，不是另一层。四个分组拆掉之后，这一页和「已完成」那一页之间
  // 的全部区别就是这一枚勾选框——而它必须真的切到切出来的清单上。
  // `includeDone: true` 写死过一次：开关画在筛选条上、标着字、还存着状态，而这一行
  // 是唯一读那个状态的地方，它没读。读者拨了开关、完成的行还在，于是面板看起来
  // 像是把行弄丢了，而不是开关坏在表面。
  const slices = itemSlicesOf(items, { query, ctx: props.matchCtx, sort: prefs.sort, includeDone: props.showDone })

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
   * 彻底删除 ONE ARCHIVED ROW, and the receipt names the thing it destroyed.
   *
   * THE ROW LEAVES THE ARRAY THROUGH THE SHARED WRITER, `removeItemRecord`, and
   * that is not a formality: it is the same function the list page's own delete
   * uses, so 「a row with this id is no longer in this document」 is one statement
   * in one place rather than a second answer written beside it. A local
   * `rows.filter(...)` would be the same sentence in a second language, and the
   * first time the two disagree the archive shows a row that has already been
   * destroyed — the one failure a purge cannot recover from.
   *
   * THE TWO HOST REFUSES GET TWO SENTENCES, and the second one is the reason this
   * function exists rather than a confirmation dialog. A short number is
   * REUSED: erase `#12` and the next row written into this document becomes
   * `#12`, so a number typed or held from a moment ago can name a row that is
   * still on the list. The host refuses to destroy it, and the reader has to be
   * told THAT — not 「删除失败」, which reads as a broken button, and not silence,
   * which reads as a success that destroyed somebody's live note.
   */
  const purgeOne = useCallback(async (row: ItemRecord) => {
    const label = itemRefOf(row).text ?? '—'
    if (props.clientId === undefined) {
      const why = whyLabelOf('hostUnavailable')
      setArchiveNote(t('item.archive.purgeRefused', { ref: label, why: why.words }), why.raw)
      return
    }
    setArchiveNote(undefined)
    setPurging(row.id)
    const reply = await itemsPurge({ id: row.id }, props.clientId)
    setPurging(undefined)
    if (!reply.ok) {
      const why = whyLabelOf(reply.why)
      setArchiveNote(t('item.archive.purgeRefused', { ref: label, why: why.words }), why.raw)
      return
    }
    // The name points at a live row, so this archive did NOT shrink — and the
    // archive is re-read rather than patched, because the live row is not ours
    // to explain here; the receipt is.
    if (reply.notDeleted) {
      setArchiveNote(t('item.archive.purgeLive', { ref: label }), 'notDeleted')
      await openArchive()
      return
    }
    if (reply.erased !== undefined) {
      setArchive(current => (current?.kind === 'ready'
        ? { kind: 'ready', rows: removeItemRecord(current.rows, row.id) }
        : current))
      setArchiveNote(t('item.archive.purged', { title: itemTitleOf(reply.erased) }), `erased ${row.id}`)
      return
    }
    // Nothing held that name any more. The reader wanted it gone and it is gone,
    // so this is a receipt and not a refusal — and the archive is re-read because
    // the row may have been taken by another device rather than by this press.
    setArchiveNote(t('item.archive.purgeGone', { ref: label }), 'nothingToErase')
    await openArchive()
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
      <section className={css.itemArchiveSection}>
        <h2 className={css.itemArchiveHead}>
          <button
            type="button"
            className={css.itemArchiveToggle}
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
            {archive.kind === 'ready' && <span className={css.itemArchiveCount}>{archive.rows.length}</span>}
          </button>
        </h2>
        <div className={css.itemArchiveList}>
          {/* The SENTENCE is what the reader reads; the raw code is the `title`, so
              the host's own vocabulary is one hover away for whoever has to
              diagnose it and invisible to everyone else. */}
          {archiveNote !== undefined && <p className={css.itemArchiveNote} role="status" title={archiveNote.raw}>{archiveNote.words}</p>}
          {archive.kind === 'loading' && <p className={css.itemArchiveNote} role="status">{t('item.loading')}</p>}
          {/* NOT REACHABLE IS NOT EMPTY. Saying 「你没有删过任何一条」 when the host
              was simply never reached would tell the reader their deletions are
              gone when they may be sitting on the disk. */}
          {archive.kind === 'unreadable' && <p className={css.itemArchiveNote} role="status">{t('item.archive.unreadable')}</p>}
          {archive.kind === 'ready' && archive.rows.length === 0 && <p className={css.itemArchiveNote}>{t('item.archive.empty')}</p>}
          {archive.kind === 'ready' && archive.rows.length > 0 && (
            <ul className={css.itemRecentList}>
              {archive.rows.map(row => (
                <li key={row.id} className={css.itemRecentRow}>
                  <span className={css.itemRefChip}>{itemRefOf(row).text ?? '—'}</span>
                  <span className={css.itemRecentTitle}><span className={css.itemRecentTitleText}>{itemTitleOf(row)}</span></span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={restoring === row.ref}
                    onClick={() => { void restoreOne(row) }}
                  >
                    {t(restoring === row.ref ? 'item.archive.restoring' : 'item.archive.restore')}
                  </Button>
                  {/* 彻底删除 IS ON THE ARCHIVED ROW AND NOWHERE ELSE. It is the one
                      press here with no undo at all, so it sits beside the row it
                      destroys rather than at the bottom of the drawer: a reader who
                      has to hunt for it is not being warned, they are being routed
                      through a maze to the irreversible. And the thirty-day sentence
                      is directly above it, which is the last thing that should be
                      said before it. */}
                  <Button
                    variant="dangerGhost"
                    size="sm"
                    disabled={purging === row.id}
                    onClick={() => { void purgeOne(row) }}
                  >
                    {t(purging === row.id ? 'item.archive.purging' : 'item.archive.purge')}
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
      {/* NO STATE BAR, NO TRIAGE STRIP, NO GROUP HEADS. Each of them was a
          second place counting something the table already says: the state bar
          named the filter the filter bar already carries, the triage strip was
          three of the three tiles the page now wears above the table, and the
          group heads were a heading per status over a column that already carries
          the status on every row. One table, one status column, one set of numbers
          — and a status appears as many times as there are rows in it, which is
          what makes the filter's count and the table's rows the same fact by
          construction. */}
      {props.batch}
      <ItemTable
        rows={props.renderRows(slices.flatMap(slice => slice.items), props.picking)}
        empty={nothingToShow}
        noMatch={items.length === 0 ? undefined : nothingToShow}
        now={props.now}
        sort={props.sort}
      />
      {archiveLine}
    </>
  )
}
