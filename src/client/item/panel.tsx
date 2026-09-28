/**
 * The task list, as a workbench of three pages.
 *
 * WHAT THIS SURFACE IS FOR. The board answers "who is running". This answers
 * "what else is on me, which one is most urgent, and what am I doing today" —
 * and it is a set of PAGES rather than one long column because each page
 * answers a different question about the same rows. A page here is a
 * CLASSIFICATION, never a second rendering: a "list / board / calendar" switch
 * would duplicate the board sitting next to it, and two surfaces keeping the
 * same state is how both end up wrong.
 *
 * WHY THE SURFACE IS QUIET. The header carries exactly four things — title,
 * search, the page rail, the capture box — and everything else lives INSIDE the
 * page it acts on, beside the rows it acts on. Low density is not fewer
 * features; it is putting each feature next to the thing it changes.
 *
 * FOUR RULES THAT SHAPE EVERY MARKUP BELOW.
 *
 * 1. The page is a QUERY, never a second copy. A page filters and orders rows
 *    that live in one document; it stores nothing, so a row edited anywhere
 *    shows the same everywhere at the same moment.
 * 2. The page rail carries CONTAINER pages only. A derived view — a tag, the
 *    neglected rows, whatever a triage line opened — is a page you ARRIVE at,
 *    not a destination the rail grows. A rail that gains an entry every time
 *    the reader asks a question has turned a map into a log.
 * 3. "The host cannot be reached" and "you have nothing" look identical if you
 *    let them, so the degraded state says which one it is. Reporting an outage
 *    as an empty list is a lie about a system fact.
 * 4. Every judgment is made in `core/item-view.ts`, never here. This file
 *    draws, and its only decisions are which page is open and which row is
 *    selected.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ItemRecord } from '../../core/item.ts'
import {
  EMPTY_ITEM_QUERY,
  ITEM_PAGES,
  ITEM_SORTS,
  itemMatchContextOf,
  itemRefOf,
  itemRowViewOf,
  itemSlicesOf,
  isInboxItem,
  parseItemQuery,
  scheduleBucketsOf,
  triageLinesOf,
  type ItemFlag,
  type ItemPageId,
  type ItemSlice,
  type ItemSort,
  type ItemStatusView,
} from '../../core/item-view.ts'
import { itemTitleOf } from '../../core/item.ts'
import { isEnglish, t, type TaskBoardKey } from '../locales.ts'
import { itemsAsk } from '../board-ask.ts'
import { itemsArchive, itemsRestore } from '../items-archive.ts'
import { Button, Segmented } from '../board/ui.tsx'
import { useSurfaceNarrow } from '../board/use-narrow.ts'
import { ItemComposer } from './composer.tsx'
import { ItemDetail } from './detail-pane.tsx'
import { ItemRowLine } from './row-line.tsx'
import { addItem, editItem, formatItemDate, removeItem, toggleItemStep, type ItemDensity, type ItemEdit } from './model.ts'
import { DEFAULT_VIEW_PREFS, readViewPrefs, toggleCollapsed, writeViewPrefs, type ItemViewPrefs } from './view-prefs.ts'
import type { ItemListFace } from './register.tsx'
import css from './item.module.css'
import boardCss from '../board.module.css'

/** The three page names, as closed keys so no name is ever built by template. */
const PAGE_LABEL: Readonly<Record<ItemPageId, 'item.page.inbox' | 'item.page.list' | 'item.page.schedule'>> = {
  inbox: 'item.page.inbox',
  list: 'item.page.list',
  schedule: 'item.page.schedule',
}
/** The accessible full name; the short one above is what a narrow rail can hold. */
const PAGE_ARIA: Readonly<Record<ItemPageId, 'item.page.inbox.aria' | 'item.page.list.aria' | 'item.page.schedule.aria'>> = {
  inbox: 'item.page.inbox.aria',
  list: 'item.page.list.aria',
  schedule: 'item.page.schedule.aria',
}
/**
 * The name of each group, read off the GROUP vocabulary.
 *
 * A row's group is what the reader sees it filed under; the value the row menu
 * writes is a different vocabulary (`item.status.*`) because it is a different
 * act. They read as the same word, and they are — but a header that silently
 * renders nothing because it reached for the wrong one is a header with no
 * name at all, which is exactly what happened once.
 */
const STATUS_LABEL: Readonly<Record<ItemStatusView, 'item.group.inProgress' | 'item.group.open' | 'item.group.blocked' | 'item.group.done'>> = {
  inProgress: 'item.group.inProgress',
  open: 'item.group.open',
  blocked: 'item.group.blocked',
  done: 'item.group.done',
}
const SORT_LABEL: Readonly<Record<ItemSort, 'item.sort.due' | 'item.sort.priority' | 'item.sort.recent' | 'item.sort.ref'>> = {
  due: 'item.sort.due',
  priority: 'item.sort.priority',
  recent: 'item.sort.recent',
  ref: 'item.sort.ref',
}
const BUCKET_LABEL: Readonly<Record<string, TaskBoardKey>> = {
  hardOverdue: 'item.bucket.hardOverdue',
  behind: 'item.bucket.behind',
  today: 'item.bucket.today',
  tomorrow: 'item.bucket.tomorrow',
  week: 'item.bucket.week',
  later: 'item.bucket.later',
  undated: 'item.bucket.undated',
  gated: 'item.bucket.gated',
}
const TRIAGE_LABEL: Readonly<Record<ItemFlag, 'item.triage.behind' | 'item.triage.stale' | 'item.triage.blocked' | 'item.triage.undated'>> = {
  behind: 'item.triage.behind',
  stale: 'item.triage.stale',
  blocked: 'item.triage.blocked',
  undated: 'item.triage.undated',
  hardOverdue: 'item.triage.behind',
  gated: 'item.triage.undated',
  linked: 'item.triage.undated',
  done: 'item.triage.undated',
}

export interface ItemListPanelProps {
  readonly face: ItemListFace
  readonly signal: AbortSignal
}

/** Whether a board card is running, keyed by card id. */
function runningMapOf(face: ItemListFace): Map<string, boolean> {
  const map = new Map<string, boolean>()
  const controller = face.controller
  if (controller === undefined) return map
  for (const task of controller.getSnapshot().tasks) {
    map.set(task.id, controller.liveStateOf(task.id) === 'running')
  }
  return map
}

/** Cards a row may hang off, already titled. Never assembled here. */
function cardsOf(face: ItemListFace): { id: string; title: string }[] {
  return (face.controller?.getSnapshot().tasks ?? [])
    .map(task => ({ id: task.id, title: task.title.trim() === '' ? task.description.trim().slice(0, 40) : task.title.trim() }))
    .filter(card => card.title !== '')
}

/**
 * The page body.
 * @param props - the slot's injected face and the plugin's own lifetime.
 * @returns the workbench, or the loading state while the replica settles.
 */
export function ItemListPanel(props: ItemListPanelProps) {
  const { face } = props
  const replica = face.replica
  const lifetime = props.signal

  const [items, setItems] = useState<readonly ItemRecord[]>(() => replica?.view() ?? [])
  const [prefs, setPrefs] = useState<ItemViewPrefs>(readViewPrefs)
  const [now, setNow] = useState(() => Date.now())
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [openRow, setOpenRow] = useState<string | undefined>(undefined)
  const [menuRow, setMenuRow] = useState<string | undefined>(undefined)
  const [confirming, setConfirming] = useState<string | undefined>(undefined)
  const [asking, setAsking] = useState<string | undefined>(undefined)
  const [asked, setAsked] = useState<string | undefined>(undefined)
  /** Undefined = the archive has not been opened, so nothing is said about it. */
  const [archive, setArchive] = useState<{ kind: 'loading' } | { kind: 'ready'; rows: readonly ItemRecord[] } | { kind: 'unreadable' } | undefined>(undefined)
  const [restoring, setRestoring] = useState<number | undefined>(undefined)
  const [archiveNote, setArchiveNote] = useState<string | undefined>(undefined)
  const seeded = useRef(false)

  // The detail lives beside the list only when there is room for both. The
  // measurement is of THIS surface, never the viewport, so it is right when the
  // shell sidebar opens, splits or collapses.
  const [narrow, surfaceRef] = useSurfaceNarrow('[data-dsh-taskboard-view]', 1080)

  // Deadlines age in front of the reader, and only while the panel is on
  // screen: a clock ticking for a surface nobody is looking at spends the
  // reader's battery on a picture they cannot see.
  useEffect(() => {
    const tick = (): void => setNow(Date.now())
    const timer = window.setInterval(tick, 60_000)
    const stop = (): void => window.clearInterval(timer)
    lifetime.addEventListener('abort', stop, { once: true })
    return () => { stop(); lifetime.removeEventListener('abort', stop) }
  }, [lifetime])

  // The replica is the only source of the list; a rebuild shows up here.
  useEffect(() => {
    if (replica === undefined) { setItems([]); return }
    const read = (): void => {
      setItems(replica.view())
      seeded.current = true
    }
    read()
    return replica.onRemote(read)
  }, [replica])

  const apply = useCallback((next: readonly ItemRecord[]) => {
    if (next === items) return
    setItems(next)
    replica?.setItems(next)
  }, [items, replica])

  /**
   * Change the view, and REMEMBER it only when it is the kind of choice that
   * outlives the session.
   *
   * The search text is the one field that is deliberately never persisted, so
   * writing on every keystroke would put a string into storage on each letter
   * only for `writeViewPrefs` to drop it — a write per character for a value
   * nobody keeps. The state still updates either way; only the write is
   * conditional.
   */
  const choose = useCallback((next: Partial<ItemViewPrefs>) => {
    setPrefs(current => {
      const merged = { ...current, ...next }
      const outlives = Object.keys(next).some(key => key !== 'search')
      if (outlives) writeViewPrefs(merged)
      return merged
    })
  }, [])

  const running = useMemo(() => runningMapOf(face), [face.controller, items])
  const cards = useMemo(() => cardsOf(face), [face.controller, items])
  const query = useMemo(() => (prefs.search.trim() === '' ? EMPTY_ITEM_QUERY : parseItemQuery(prefs.search)), [prefs.search])
  const matchCtx = useMemo(() => ({ ...itemMatchContextOf(now), running }), [now, running])
  const lostHost = replica?.hostLostItems() === true
  const filtering = prefs.search.trim() !== ''

  /**
   * Open the archive: the rows a delete is still holding.
   *
   * Three states, not two, and the third is the one that matters: an archive
   * that failed to load must not look like an archive with nothing in it. "You
   * have not removed anything" and "I could not reach the host" are different
   * facts, and showing the first when the second happened would tell the reader
   * their deletions are gone when they may be sitting on the disk.
   */
  const openArchive = useCallback(async () => {
    setArchive({ kind: 'loading' })
    const reply = await itemsArchive()
    setArchive(reply.ok ? { kind: 'ready', rows: reply.deleted } : { kind: 'unreadable' })
  }, [])

  /** Put one row back, then re-read — the archive is now a different document. */
  const restoreOne = useCallback(async (item: ItemRecord) => {
    const clientId = replica?.clientId()
    if (clientId === undefined) { setArchiveNote(t('item.archive.refused', { ref: `#${item.ref}`, why: 'hostUnavailable' })); return }
    setArchiveNote(undefined)
    setRestoring(item.ref)
    const reply = await itemsRestore(item.ref, clientId)
    setRestoring(undefined)
    setArchiveNote(reply.ok && reply.restored !== undefined
      ? t('item.archive.restored', { ref: `#${item.ref}` })
      : t('item.archive.refused', {
        ref: `#${item.ref}`,
        why: reply.ok ? 'gone' : reply.why,
      }))
    if (reply.ok) await openArchive()
  }, [openArchive, replica])

  const askOne = useCallback((item: ItemRecord) => {    // Read once: the closure outlives this line, and a property re-proven
    // inside an async callback is a narrowing that stops holding when the
    // reader renames the row mid-flight.
    const taskId = item.taskId
    if (taskId === undefined) return
    setAsking(item.id)
    void (async () => {
      try {
        const body = await itemsAsk({ taskId, ref: item.ref })
        setAsked(body.ok
          ? t('item.ask.said', { sessionId: body.sessionId })
          : t('item.ask.refused', { why: body.why }))
      } catch (error) {
        setAsked(t('item.ask.refused', { why: error instanceof Error ? error.message : String(error) }))
      } finally {
        setAsking(undefined)
      }
    })()
  }, [])

  if (replica === undefined) {
    return (
      <div className={css.itemPanelStage} data-dsh-taskboard-view="">
        <div className={css.itemRoot}>
          <p className={css.itemState} role="status">{t('item.loading')}</p>
        </div>
      </div>
    )
  }

  const english = isEnglish()
  const showDetailPane = !narrow
  const shown = selected !== undefined ? items.filter(item => item.id === selected) : items
  const slices = itemSlicesOf(items, { query, ctx: matchCtx, sort: prefs.sort, includeDone: prefs.showDone })
  const buckets = scheduleBucketsOf(items, query, matchCtx, prefs.sort)
  const triage = triageLinesOf(items, now)

  const picked = selected === undefined ? undefined : items.find(item => item.id === selected)

  const detail = (item: ItemRecord | undefined) => (
    <ItemDetail
      item={item}
      cards={cards}
      counts={slices.map(slice => ({ label: t(STATUS_LABEL[slice.status]), value: slice.items.length }))}
      recent={[...items]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5)
        // `itemRefOf` rather than a template: a row the document has not
        // numbered yet has no name to show, and building `#${item.ref}` here
        // would put the ledger's own "nobody has numbered me" sentinel back on
        // screen — the exact thing the row line refuses to do.
        .map(item => ({ ref: itemRefOf(item).text ?? '—', title: itemTitleOf(item), id: item.id }))}
      confirmingRemove={confirming === item?.id}
      onConfirmRemove={() => { if (item !== undefined) { apply(removeItem(items, item.id)); setConfirming(undefined); setSelected(undefined) } }}
      onCancelRemove={() => setConfirming(undefined)}
      onPickRecent={id => setSelected(id)}
      onEdit={(patch: ItemEdit) => { if (item !== undefined) apply(editItem(items, item.id, patch, Date.now())) }}
      onToggleStep={stepId => { if (item !== undefined) apply(toggleItemStep(items, item.id, stepId, Date.now())) }}
      onRemove={() => { if (item !== undefined) setConfirming(item.id) }}
    />
  )

  const rows = (list: readonly ItemRecord[]) => list.map(item => (
    <ItemRowLine
      key={item.id}
      view={itemRowViewOf(item, { now, running })}
      density={prefs.density}
      expanded={openRow === item.id}
      selected={selected === item.id}
      inPlace={narrow}
      panelId="item"
      menuOpen={menuRow === item.id}
      asking={asking === item.id}
      onToggle={() => setOpenRow(openRow === item.id ? undefined : item.id)}
      onSelect={() => setSelected(item.id)}
      onAsk={() => askOne(item)}
      onMenuToggle={() => setMenuRow(menuRow === item.id ? undefined : item.id)}
      onMenuClose={() => setMenuRow(undefined)}
      onMark={status => { apply(editItem(items, item.id, { status }, Date.now())); setMenuRow(undefined) }}
      onPromote={() => setMenuRow(undefined)}
      onRemove={() => { setConfirming(item.id); setMenuRow(undefined) }}
      detail={narrow ? detail(item) : undefined}
    />
  ))

  const listPage = (slices: readonly ItemSlice[]) => slices.map(slice => {
    const folded = prefs.collapsed.includes(slice.status)
    const ratio = slice.progress === undefined ? undefined : slice.progress.total === 0 ? 0 : slice.progress.done / slice.progress.total
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
            <span className={css.itemGroupChevron} aria-hidden="true">›</span>
            {t(STATUS_LABEL[slice.status])}
            <span className={css.itemGroupCount}>{slice.items.length}</span>
          </button>
          {/* The group's own arithmetic, and a 2px bar BESIDE its number rather
              than a rule under the head: at the full group measure a hairline
              sitting under the text reads as an underline of that text, and one
              that appears on some groups and not others reads as a selection.
              No steps means no bar and no bare zero. */}
          {slice.progress !== undefined && (
            <p className={css.itemGroupStats}>
              {t('item.groupSteps', { done: String(slice.progress.done), total: String(slice.progress.total) })}
              <span className={css.itemGroupProgress}>
                <span className={css.itemGroupProgressFill} style={{ inlineSize: `${Math.round((ratio ?? 0) * 100)}%` }} />
              </span>
            </p>
          )}
        </h2>
        <div className={css.itemGroupList} id={`item-group-${slice.status}`}>
          {folded
            ? null
            : slice.items.length === 0
              ? <p className={css.itemEmptyGroup}>{t('item.group.empty')}</p>
              : <ul className={css.itemList}>{rows(slice.items)}</ul>}
        </div>
      </section>
    )
  })

  // The inbox membership is READ, never restated. This predicate also decides
  // which rows the triage strip's "no date" line EXEMPTS, so an inline copy
  // here is a second answer to a question two surfaces already share: change
  // one and the panel and the strip quietly disagree about what "unfiled" is.
  const inbox = useMemo(() => items.filter(isInboxItem), [items])

  const body = prefs.page === 'inbox'
    ? (
      <>
        <p className={css.itemInboxNote}>{t('item.inbox.note')}</p>
        <div className={css.itemInboxList}>
          {inbox.length === 0
            ? <p className={css.itemState}>{t('item.empty')}</p>
            : <ul className={css.itemList}>{rows(inbox)}</ul>}
        </div>
      </>
    )
    : prefs.page === 'list'
      ? (
        <>
          {/* Every line is a sentence AND a button. A number a reader cannot act
              on is a scoreboard, and a scoreboard on a personal list rewards
              opening the app rather than finishing anything. */}
          {triage.length === 0
            ? <p className={css.itemTriageText}>{t('item.triage.nothing')}</p>
            : (
              <div className={css.itemTriage} aria-label={t('item.triage.title')}>
                <h3 className={css.itemSectionTitle}>{t('item.triage.title')}</h3>
                {triage.map(line => (
                  <div key={line.id} className={css.itemTriageRow} data-severity={line.severity}>
                    <span className={css.itemTriageText}>
                      {t(TRIAGE_LABEL[line.id], {
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
              </div>
            )}
          {/* THE ARCHIVE LINE, and the archive itself when it is open. A
              capture-first surface lives or dies on 「我没有刚弄丢」, so the way
              back is announced here rather than hidden behind a menu nobody
              opens — and it states the window instead of implying it, because a
              restore button that has quietly stopped working is worse than one
              that never appeared.

              The archive is a PAGE the reader arrives at, not a rail entry: a
              rail that grows a tab every time the reader asks a question turns
              a map into a log. */}
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
                  {archiveNote !== undefined && (
                    <p className={css.itemState} role="status">{archiveNote}</p>
                  )}
                  {archive.kind === 'loading' && <p className={css.itemState} role="status">{t('item.loading')}</p>}
                  {/* Not reachable is NOT empty. Saying 「你没有删过任何一条」 when
                      the host was simply never reached would tell the reader their
                      deletions are gone when they may be sitting on the disk. */}
                  {archive.kind === 'unreadable' && (
                    <p className={css.itemState} role="status">{t('item.archive.unreadable')}</p>
                  )}
                  {archive.kind === 'ready' && archive.rows.length === 0 && (
                    <p className={css.itemState}>{t('item.archive.empty')}</p>
                  )}
                  {archive.kind === 'ready' && archive.rows.length > 0 && (
                    <ul className={css.itemList}>
                      {archive.rows.map(row => (
                        <li key={row.id} className={css.itemRow} data-status="done">
                          <span className={css.itemRef}>{itemRefOf(row).text ?? '—'}</span>
                          <span className={css.itemTitle}>
                            <span className={css.itemTitleText}>{itemTitleOf(row)}</span>
                          </span>
                          <span className={css.itemRowActions}>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={restoring === row.ref}
                              onClick={() => { void restoreOne(row) }}
                            >
                              {t(restoring === row.ref ? 'item.archive.restoring' : 'item.archive.restore')}
                            </Button>
                          </span>
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
          {filtering && (
            <div className={css.itemFilterRow}>
              <Button variant="ghost" size="sm" className={css.itemClearFilter} onClick={() => choose({ search: '' })}>
                {t('item.filter.clear')}
              </Button>
            </div>
          )}
          {shown.length === 0 && filtering
            ? <p className={css.itemState}>{t('item.noMatch')}</p>
            : items.length === 0              /* AN EMPTY DOCUMENT IS NOT THREE EMPTY GROUPS. Keeping an empty
                 group's header is a rule about a list that HAS rows and one
                 group that happens to be empty — it keeps the reader's map.
                 With nothing in the document there is no map to keep, and three
                 headers each saying 「这一组还没有事项」 is the same sentence
                 three times: the first screen a new reader meets says "nothing
                 here" three times and never says what this panel is FOR. One
                 sentence, and it is about the panel. */
              ? <p className={css.itemState}>{t('item.empty')}</p>
              : listPage(slices)}
        </>
      )
      : (
        <div className={css.itemAgenda}>
          {buckets.map(bucket => {
            // The two buckets that answer a DIFFERENT question get their own
            // named containers, not an absence. A reader who cannot see where a
            // row went assumes it was lost — and "not yet startable" and "no
            // date" are exactly the two rows a reader would assume were lost.
            if (bucket.id === 'gated') {
              if (bucket.items.length === 0) return null
              return (
                <section key={bucket.id} className={css.itemGatedFold}>
                  <h2 className={css.itemGatedFoldHead}>
                    {t(BUCKET_LABEL.gated)}
                    <span className={css.itemGroupCount}>{bucket.items.length}</span>
                  </h2>
                  <p className={css.itemHint}>{t('item.gated.hint')}</p>
                  <div className={css.itemGatedFoldList}>
                    <ul className={css.itemList}>{rows(bucket.items)}</ul>
                  </div>
                </section>
              )
            }
            if (bucket.id === 'undated') {
              return (
                <section key={bucket.id} className={css.itemNoDateTray}>
                  <h2 className={css.itemNoDateTrayLabel}>
                    {t(BUCKET_LABEL.undated)}
                    <span className={css.itemGroupCount}>{bucket.items.length}</span>
                  </h2>
                  {bucket.items.length > 0 && <p className={css.itemHint}>{t('item.noDate.hint')}</p>}
                  <div className={css.itemGroupList}>
                    {bucket.items.length === 0
                      ? <p className={css.itemEmptyGroup}>{t('item.agenda.emptyDay')}</p>
                      : <ul className={css.itemList}>{rows(bucket.items)}</ul>}
                  </div>
                </section>
              )
            }
            return (
              <section key={bucket.id} className={css.itemAgendaDay}>
                <h2 className={css.itemGroupHead}>
                  <span className={css.itemGroupToggle}>
                    {t(BUCKET_LABEL[bucket.id] ?? 'item.bucket.later')}
                    <span className={css.itemGroupCount}>{bucket.items.length}</span>
                  </span>
                  {bucket.day !== undefined && (
                    <span className={css.itemAgendaDayLabel}>{formatItemDate(bucket.day, english)}</span>
                  )}
                </h2>
                <div className={css.itemAgendaList}>
                  {bucket.items.length === 0
                    ? <p className={css.itemEmptyGroup}>{t('item.agenda.emptyDay')}</p>
                    : <ul className={css.itemList}>{rows(bucket.items)}</ul>}
                </div>
              </section>
            )
          })}
        </div>
      )

  return (
    <div className={css.itemPanelStage} data-dsh-taskboard-view="">
      <div className={css.itemRoot}>
        <header className={css.itemHeader}>
          <div className={css.itemHeaderRow}>
            <h1 className={css.itemHeadTitle}>{t('itemTab.title')}</h1>
            <p className={css.itemCount}>
              {filtering
                ? t('item.countFiltered', { shown: String(shown.length), total: String(items.length) })
                : t('item.count', { n: String(items.length) })}
            </p>
          </div>

          <div className={css.itemSearchRow}>
            <input
              className={css.itemSearch}
              value={prefs.search}
              placeholder={t('item.search')}
              aria-label={t('item.search')}
              onChange={event => choose({ search: event.target.value })}
            />
          </div>

          <div className={css.itemPageRail} role="tablist" aria-label={t('item.page.rail')}>
            {ITEM_PAGES.map(page => (
              <button
                key={page}
                type="button"
                role="tab"
                aria-selected={prefs.page === page}
                aria-label={t(PAGE_ARIA[page])}
                className={`${css.itemPageTab}${prefs.page === page ? ` ${css.itemPageTabActive}` : ''}`}
                onClick={() => choose({ page })}
              >
                {t(PAGE_LABEL[page])}
              </button>
            ))}
          </div>

          {prefs.page === 'list' && (
            <div className={css.itemHeaderRow} aria-label={t('item.filter.label')}>
              <Segmented
                ariaLabel={t('item.sort.label')}
                value={prefs.sort}
                options={ITEM_SORTS.map(sort => ({ value: sort, label: t(SORT_LABEL[sort]) }))}
                onChange={next => choose({ sort: next as ItemSort })}
              />
              {/* Density is a low-frequency choice, and on a phone the second
                  control costs a whole line and says nothing the reader needs
                  while they are scanning. It is not hidden — the wide band has
                  it, and the narrow band's job is to give the LIST the width. */}
              {!narrow && (
                <Segmented
                  ariaLabel={t('item.density')}
                  value={prefs.density}
                  options={[
                    { value: 'compact', label: t('item.density.compact') },
                    { value: 'comfy', label: t('item.density.comfy') },
                  ]}
                  onChange={next => choose({ density: next as ItemDensity })}
                />
              )}
            </div>
          )}

          <ItemComposer
            now={now}
            onSave={input => {
              const result = addItem(items, input, Date.now())
              // A refusal changes nothing AND keeps the words, so the reader can
              // finish the thought instead of losing it to a surprise.
              if (result.added === undefined) return false
              apply(result.items)
              return true
            }}
          />
        </header>

        {/* Reading in-flight, unreachable and syncing are THREE different
            facts, and NEITHER hides the list: the local mirror is whole and
            usable, so covering it would be a worse answer than a banner. A row
            written here is already on screen before the host has it, and saying
            so is the difference between "saved" and "saved everywhere". */}
        {lostHost
          ? <p className={css.itemState} role="status">{t('item.hostLost')}</p>
          : replica.isSynced() === false && <p className={css.itemState} role="status">{t('item.syncing')}</p>}
        {asked !== undefined && <p className={css.itemState} role="status" data-ask-receipt="">{asked}</p>}

        <div className={css.itemWorkbench} ref={surfaceRef}>
          {/* `.dshTbScroll` is the SHARED scroll mount — the one class the
              board's thin-bar rules are written against. The list's own sheet
              deliberately does not restate them, so a Chromium change moves one
              mechanism instead of two that drift. */}
          <div className={`${narrow ? css.itemScroll : css.itemListPane} ${boardCss.dshTbScroll}`}>
            {body}
          </div>
          {showDetailPane && (
            <div className={css.itemDetailPane}>
              {/* The pane is titled by the ROW ON SHOW, never by one of the five
                  section names inside it. A section name as a page title says
                  「here are the fields」 before the reader knows which row they
                  are looking at — and the whole point of the pane is that the
                  list beside it stays readable.

                  With nothing picked the head says NOTHING: the empty state
                  below already opens with that sentence, and saying it twice
                  in one column reads as two panes that failed to load. */}
              <div className={css.itemDetailHead}>
                {picked !== undefined && (
                  <h2 className={css.itemSectionTitle}>
                    <span className={css.itemRef}>{itemRefOf(picked).text ?? '—'}</span>
                    {' '}
                    {itemTitleOf(picked)}
                  </h2>
                )}
              </div>
              <div className={`${css.itemDetailBody} ${boardCss.dshTbScroll ?? ''}`}>
                {detail(picked)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Re-exported so the panel's own contract test can name the defaults. */
export { DEFAULT_VIEW_PREFS }
