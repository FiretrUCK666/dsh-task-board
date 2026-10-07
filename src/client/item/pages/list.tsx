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
import { useCallback, useEffect, useState } from 'react'
import { itemSlicesOf } from '../../../core/item-view.ts'
import type { ItemRecord } from '../../../core/item.ts'
import { itemRefOf } from '../../../core/item-view.ts'
import { itemTitleOf } from '../../../core/item.ts'
import { t } from '../../locales.ts'
import { itemsArchive, itemsPurge, itemsRestore, archiveClockOf, type ArchiveReply } from '../../items-archive.ts'
import { Tickbox } from '../tickbox.tsx'
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
   * is what the archive shows next to every row. There is no per-row erase left
   * for a number to track: the irreversible lives on the drawer's own bar, and
   * the bar disables the WHOLE act while it is away (below).
   */
  /** Whether the batch erase is running: every erase press disables while it is away. */
  const [purgingAll, setPurgingAll] = useState(false)
  /**
   * WHICH ARCHIVED ROWS THE READER IS HOLDING, by identity.
   *
   * The archive's multi-select is its own holding and not the list page's: the
   * two batches act on two different documents (this one holds TOMBSTONES the
   * client cannot see in `view()`), and sharing one state would let a pick made
   * in the drawer ride out of it and name nothing on the list above. It clears
   * whenever the drawer re-opens and whenever a row it names is drained, so a
   * holding never outlives the rows it names.
   */
  const [archivePicks, setArchivePicks] = useState<ReadonlySet<string>>(new Set())
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
   * THE RAIL'S 「已删除」 OPENS THIS DRAWER.
   *
   * 它按下去之前与「全部」完全一样，所以左栏上那一行印着的数字是一个读者按了却
   * 看不到任何变化的数字——而**看不见变化的按钮比没有按钮更糟**：读者分不清是自己
   * 记错了还是这一行坏了。
   *
   * 所以这是一个**值**，而它的所有者是面板：抽屉的行、它的恢复、它的彻底删除仍住在
   * 这里，但「读者是不是站在归档里」属于整块面板——于是每一页都能开它，每一条左栏的
   * 路都能关它。开与关是同一件事的两面，分开住在两个地方就必然有一面漏掉。
   */
  useEffect(() => {
    if (!props.archiveOpen) return
    setArchiveNote(undefined)
    setArchivePicks(new Set())
    void openArchive()
  }, [props.archiveOpen, openArchive])

  /** A drawer whose holding never outlives the rows it names:
   *  the re-read after any write filters the holding against what is back. */
  useEffect(() => {
    if (archive?.kind !== 'ready') return
    setArchivePicks(current => {
      const next = new Set([...current].filter(id => archive.rows.some(row => row.id === id)))
      return next.size === current.size ? current : next
    })
  }, [archive])

  /** Hold one archived row, or release it. Pure state: nothing is sent until the
   *  confirm bar's own button is pressed. */
  const toggleArchivePick = useCallback((id: string): void => {
    setArchivePicks(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /** Hold every row the drawer shows, or none of them. */
  const pickAllArchive = useCallback((on: boolean): void => {
    setArchivePicks(current => {
      if (!on) return current.size === 0 ? current : new Set()
      if (archive?.kind !== 'ready') return current
      return new Set(archive.rows.map(row => row.id))
    })
  }, [archive])

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
   * 「彻底删除」 EVERY ROW THE READER HELD, one call per row, one receipt for the
   * whole act.
   *
   * THE LOOP IS THE HOST CONTRACT, not laziness: each erase is a host operation
   * addressed by identity (see itemsPurge), and there is no batch route to speak
   * of, so N picks are N calls with the SAME verbs the single-row erase spoke.
   * The per-row one is gone because the drawer's bar owns the irreversible now:
   * a row-level button next to every row is one more 「go away」 than this
   * surface needs, and the confirm bar says the cost BEFORE it instead of
   * beside it.
   *
   * EVERY OUTCOME IS COUNTED, and the receipt says the count: all gone is the
   * destroyed sentence, a partial is the partial one — never a plain 「done」 that
   * would swallow refusals. The erase is disabled while it runs, so a double
   * press is not double destruction.
   */
  const purgePicked = useCallback(async () => {
    const rows = archive?.kind === 'ready' ? archive.rows.filter(row => archivePicks.has(row.id)) : []
    if (rows.length === 0) return
    if (props.clientId === undefined) {
      const why = whyLabelOf('hostUnavailable')
      setArchiveNote(t('item.archive.batchRefused', { why: why.words }), why.raw)
      return
    }
    setArchiveNote(undefined)
    setPurgingAll(true)
    let killed = 0
    let refused = 0
    const drained: string[] = []
    for (const row of rows) {
      const reply = await itemsPurge({ id: row.id }, props.clientId)
      // THREE HOST VERDITS, THREE HOLDINGS. 「erased」 or 「nothing left to erase」
      // both end with the row absent from the archive and the holding: the
      // reader asked for it to be gone and either answer is it being gone.
      // 「notDeleted」 is different matter — the SHORT NUMBER was reused and the
      // host refused to destroy somebody's live note — so that row STAYS in the
      // drawer, in the holding, counted under 「没能删」. A receipt that folded a
      // live row into 「已删」 would be the archive lying about the one thing it
      // exists to be honest about.
      if (reply.ok && reply.notDeleted !== true) {
        killed += 1
        drained.push(row.id)
        // The host's own revision settles the tombstone locally: the rail's
        // count stops naming the erased row in the same turn, not at the next
        // coalesced resync.
        props.onPurged?.(row.id, reply.revision)
      } else {
        refused += 1
      }
    }
    setPurgingAll(false)
    setArchivePicks(current => {
      // HELD ROWS THAT SURVIVED (the refusals) stay held; the released set only
      // drops the rows that actually left.
      const next = new Set([...current].filter(id => !drained.includes(id)))
      return next.size === current.size ? current : next
    })
    setArchive(current => (current?.kind === 'ready'
      ? { kind: 'ready', rows: current.rows.filter(row => !drained.includes(row.id)) }
      : current))
    setArchiveNote(killed === 0
      ? t('item.archive.destroyedNone', { m: String(refused) })
      : refused === 0
        ? t('item.archive.destroyed', { n: String(killed) })
        : t('item.archive.destroyedPartial', { n: String(killed), m: String(refused) }), `erased batch ${killed}/${refused}`)
    await openArchive()
  }, [archive, archivePicks, openArchive, props.clientId, props.onPurged])

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
  /* **页尾那一行没有了：归档的入口是左栏那一行「已删除」。**
   *
   * 这一行原来写着「删除后 30 天内可以找回来。」加一枚「看看」，画在整页内容的最下面。
   * 它和左栏那个「已删除 3」是**同一扇门的第二扇**，而第二扇门比第一扇远：读者要滚到
   * 页尾才知道有归档这回事，而左栏那个数一直在那儿、还带着条数。
   *
   * PRODUCT 里那条「窗口说出来」的承诺仍然成立，只是它说的话改由两处说，而两处都在
   * 读者正好需要它的时刻：**删掉的那一刻**（就近撤销那条回执上写着 30 天），以及
   * **进到归档里之后**（抽屉的头行写着同一句）。页尾这一处是第三遍，而它是唯一一处
   * 读者既不需要、也读不到的位置。
   *
   * 一行不再出现的文案，是这一页唯一一种「少一点东西」的干净做法：它没有替换者，
   * 因为那句话本来就有人说了。 */
  /* THE DRAWER IS OPEN WHEN THE PANEL SAYS SO — the rows it draws are still this
   * page's, but 「am I in the archive」 is one fact about the whole surface. It used
   * to be this page's own `archive` being defined, which is why nothing but the
   * drawer's own button could close it: a rail row could neither open it on
   * another page nor close it on this one, because a second copy of 「open」 lived
   * here and only here. */
  const archiveLine = !props.archiveOpen || archive === undefined
    ? undefined
    : (
      <section className={css.itemArchiveSection}>
        <h2 className={css.itemArchiveHead}>
          <button
            type="button"
            className={css.itemArchiveToggle}
            onClick={() => { setArchiveNote(undefined); props.onCloseArchive() }}
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
          {/* AN EMPTY ARCHIVE IS AN EMPTY PAGE, not a note in a corner: the sentence
              stands centred in the room the page has, the way an empty sheet reads. */}
          {archive.kind === 'ready' && archive.rows.length === 0 && (
            <div className={css.itemArchiveVoid}>
              <p>{t('item.archive.empty')}</p>
            </div>
          )}
          {archive.kind === 'ready' && archive.rows.length > 0 && (
            <>
              {/* THE DRAWER'S OWN BAR, and it is a PLACE and not a button row: one
                  sentence about the clock always here, and — the moment a row is
                  held — that place becomes the one consequence-bearing
                  confirmation in the whole surface. A plain 「删除所有」 button that
                  vanishes when pressed is a control whose worst press is its
                  smoothest; the sentence is what says the cost BEFORE it. */}
              <div className={css.itemArchiveBar}>
                <p className={css.itemArchiveSay}>{t('item.archive.bar')}</p>
                {archivePicks.size > 0
                  ? (
                      <div className={css.itemArchiveConfirm}>
                        <span aria-live="polite">{t('item.archive.confirm', { n: String(archivePicks.size) })}</span>
                        <Button variant="ghost" size="sm" disabled={purgingAll} onClick={() => setArchivePicks(new Set())}>
                          {t('item.archive.keep')}
                        </Button>
                        <Button variant="dangerGhost" size="sm" disabled={purgingAll} onClick={() => { void purgePicked() }}>
                          {t(purgingAll ? 'item.archive.purgingAll' : 'item.archive.kill')}
                        </Button>
                      </div>
                    )
                  : (
                      <div className={css.itemArchiveActs}>
                        <Button variant="ghost" size="sm" onClick={() => pickAllArchive(true)}>{t('item.batch.all')}</Button>
                      </div>
                    )}
              </div>
              {/* ONE ROW, THREE TRACKS: the box the hand reaches for, the row's own
                  words, and the way back. The box leads because what you do in here
                  is pick a row; the restore button is on EVERY row in every state
                  (a rescue that needs a mode first is a rescue withheld), and the
                  meta line names the row's number and — the moment the host sends
                  the stamp it keeps — how long the row has left. */}
              <ul className={css.itemArchiveRowList}>
                {archive.rows.map(row => {
                  const clock = archiveClockOf(row, props.now)
                  return (
                    <li key={row.id} className={css.itemArchiveRow} data-picked={archivePicks.has(row.id) ? '' : undefined}>
                      <Tickbox
                        checked={archivePicks.has(row.id)}
                        label={t('item.batch.hold')}
                        onToggle={() => toggleArchivePick(row.id)}
                      />
                      <span className={css.itemArchiveCell}>
                        <span className={css.itemArchiveTitle}><span className={css.itemRecentTitleText}>{itemTitleOf(row)}</span></span>
                        <span className={css.itemArchiveMeta}>
                          <span className={css.itemRefChip}>{itemRefOf(row).text ?? '—'}</span>
                          {/* THE CLOCK SAYS ITSELF ONLY WHEN THE HOST SENT THE STAMP.
                              A row without a stamp is NOT given a guessed date. */}
                          {clock !== undefined && (
                            <span>{t('item.archive.days', { gone: String(clock.gone), left: String(clock.left) })}</span>
                          )}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={restoring === row.ref}
                        onClick={() => { void restoreOne(row) }}
                      >
                        {t(restoring === row.ref ? 'item.archive.restoring' : 'item.archive.restore')}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      </section>
    )

return (
    <>
      {/* THE READER IS STANDING IN ONE OF TWO PLACES. 点左栏「已删除」进来之后，
          这一页**就是归档页**：内容只剩已删除的那些（或空），列表与批量条都不在这
          里——它们说的话对这一页的行不成立。再点一次同一行（或抽屉头上的「已删
          除」）回去。两种状态都是完整的页面，不是「一张表下面多了一段」。 */}
      {props.archiveOpen
        ? (
            <div className={css.itemArchivePage}>
              {archive === undefined && <p className={css.itemArchiveNote} role="status">{t('item.loading')}</p>}
              {archive !== undefined && archiveLine}
            </div>
          )
        : (
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
                rows={props.renderRows(slices.flatMap(slice => slice.items), props.picking, props.armed === true)}
                empty={nothingToShow}
                noMatch={items.length === 0 ? undefined : nothingToShow}
                now={props.now}
                sort={props.sort}
                dayHeads
              />
            </>
          )}
    </>
  )
}
