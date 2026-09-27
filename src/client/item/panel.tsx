/**
 * The task list, as a page of DSH's own right Sidebar.
 *
 * WHAT THIS SURFACE IS FOR. The board is where work is executed; this is where
 * a thought is caught before it becomes a card. So the list is scanned, not
 * audited: level 0 answers "what is going on" in one glance, level 1 answers
 * "what is this exactly" for the one row you picked. There is no level 3,
 * because a third level inside a 300px column is where readers lose their
 * place entirely.
 *
 * FOUR RULES THAT SHAPE EVERY MARKUP BELOW.
 *
 * 1. The column is about 300px wide, so the design target is THAT width, not
 *    the viewport. The root declares its own `container-type` (the sidebar
 *    chain declares none) and every width decision is made against it.
 * 2. Nothing important hides behind a hover or behind a second click. A row's
 *    state is legible while the list is at rest.
 * 3. "The host cannot be reached" and "you have no items" look identical if you
 *    let them, so the degraded state says which one it is. Reporting an
 *    outage as an empty list is a lie about a system fact.
 * 4. Every judgment is made in `model.ts`, never here. This file draws.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ItemRecord } from '../../core/item.ts'
import { ITEM_PRIORITIES, ITEM_STATUSES } from '../../core/item.ts'
import { isEnglish, t, type TaskBoardKey } from '../locales.ts'
import { Button, Icon } from '../board/ui.tsx'
import { Chip } from '../board/Chip.tsx'
import {
  addItem,
  editItem,
  formatItemDate,
  groupOpenByDefault,
  ITEM_GROUPS,
  itemGroupSlicesOf,
  itemRowViewOf,
  NO_ITEM_FILTER,
  parseItemDate,
  readItemDensity,
  removeItem,
  toItemDateField,
  toggleItemStep,
  writeItemDensity,
  type ItemDensity,
  type ItemEdit,
  type ItemFilter,
  type ItemGroup,
} from './model.ts'
import type { ItemListFace } from './register.tsx'
import css from '../board.module.css'

/**
 * Closed-union → copy key, one entry each.
 *
 * These tables exist so NO key is ever built by a template string. A cast
 * (`t(\`item.group.${g}\` as TaskBoardKey)`) silences the checker: a typo
 * compiles, ships, and renders `undefined` at runtime — the same defect the
 * board had at `TaskDetail.tsx:885`. A `Record<ItemGroup, TaskBoardKey>` is
 * checked in both directions, so a renamed group or a renamed key is a
 * compile error instead of a blank word in the panel.
 */
const GROUP_KEYS: Readonly<Record<ItemGroup, TaskBoardKey>> = {
  inProgress: 'item.group.inProgress',
  open: 'item.group.open',
  blocked: 'item.group.blocked',
  done: 'item.group.done',
}
const PRIORITY_KEYS: Readonly<Record<ItemRecord['priority'], TaskBoardKey>> = {
  low: 'item.priority.low',
  normal: 'item.priority.normal',
  high: 'item.priority.high',
  urgent: 'item.priority.urgent',
}
const ORIGIN_KEYS: Readonly<Record<ItemRecord['origin']['source'], TaskBoardKey>> = {
  human: 'item.origin.human',
  ai: 'item.origin.ai',
  import: 'item.origin.import',
}
const DENSITY_KEYS: Readonly<Record<ItemDensity, TaskBoardKey>> = {
  compact: 'item.density.compact',
  comfy: 'item.density.comfy',
}

/**
 * The panel's props: the face we publish, and OUR OWN lifetime.
 *
 * There is no tab hook here any more, because this is no longer a tab body.
 * The signal is the drawer's, so every timer and subscription below hangs on
 * the surface that actually owns them rather than on a host contract that no
 * longer applies.
 */
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

/** The reader's chosen row height, read once and remembered on change. */
function useDensity(): [ItemDensity, (next: ItemDensity) => void] {
  const [density, setDensity] = useState<ItemDensity>(readItemDensity)
  const choose = useCallback((next: ItemDensity) => {
    setDensity(next)
    writeItemDensity(next)
  }, [])
  return [density, choose]
}

/** How a group reads in the reader's language. */
function groupLabel(group: ItemGroup): string {
  return t(GROUP_KEYS[group])
}

/**
 * One row of the list. Clicking it opens level 1 in place.
 *
 * Exported so the detail — the part a reader can actually fill in — can be
 * rendered with it OPEN in a test. Asserting "this control exists" against a
 * collapsed row proves nothing: the control is not in the DOM at all until the
 * row is open, and a test that pretended otherwise would have been testing a
 * fiction.
 */
export function ItemRow(props: {
  readonly view: ReturnType<typeof itemRowViewOf>
  readonly density: ItemDensity
  readonly english: boolean
  readonly expanded: boolean
  readonly fresh: boolean
  readonly panelId: string
  readonly onToggle: () => void
  readonly onEdit: (edit: ItemEdit) => void
  readonly onToggleStep: (stepId: string) => void
  readonly onRemove: () => void
  /** The board cards this item may hang off, already titled. */
  readonly cards: readonly { readonly id: string; readonly title: string }[]
  /** The title of the card it currently hangs off, or undefined if it has none. */
  readonly linkedCardTitle: string | undefined
}) {
  const { view, density, english, expanded, fresh, panelId, onToggle, onEdit, onToggleStep, onRemove, cards, linkedCardTitle } = props
  const { item, ref, title, status, progress, meta } = view
  const regionId = `${panelId}-${item.id}`
  return (
    <li
      className={css.itemRow}
      data-open={expanded ? '' : undefined}
      data-fresh={fresh ? '' : undefined}
      data-status={status}
    >
      <button
        type="button"
        className={css.itemRowMain}
        data-density={density}
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={onToggle}
      >
        <span className={css.itemStateMark} aria-hidden="true" />
        <span className={css.itemRef}>{ref}</span>
        <span className={css.itemTitle}>{title}</span>
        {meta.kind === 'due' && (
          <span className={css.itemDue} data-overdue={meta.overdue ? '' : undefined} data-hard={meta.hard ? '' : undefined}>
            {t(meta.overdue ? 'item.due.overdue' : 'item.due.upcoming', { when: formatItemDate(meta.at, english) })}
          </span>
        )}
        {meta.kind === 'steps' && (
          <span className={css.itemSteps}>
            {t('item.steps', { done: String(meta.done), total: String(meta.total) })}
          </span>
        )}
      </button>

      {/* The bar is the ratio and nothing else; the count sits beside it, never
          inside it, and with no steps there is no bar at all. */}
      {progress !== undefined && (
        <span className={css.itemProgress} aria-hidden="true">
          <span className={css.itemProgressFill} style={{ inlineSize: `${Math.round(progress.ratio * 100)}%` }} />
        </span>
      )}

      {expanded && (
        <div className={css.itemDetail} id={regionId}>
          {progress !== undefined && (
            <p className={css.itemProgressText}>
              {t('item.steps', { done: String(progress.done), total: String(progress.total) })}
            </p>
          )}
          {item.steps.length > 0 && (
            <ul className={css.itemStepList}>
              {item.steps.map(step => (
                <li key={step.id}>
                  <label className={css.itemStep}>
                    <input
                      type="checkbox"
                      checked={step.done}
                      onChange={() => onToggleStep(step.id)}
                    />
                    <span data-done={step.done ? '' : undefined}>{step.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <ItemField label={t('item.field.title')}>
            <input
              className={css.itemInput}
              value={item.title}
              onChange={e => onEdit({ title: e.target.value })}
            />
          </ItemField>
          <ItemField label={t('item.field.body')}>
            <textarea
              className={css.itemInput}
              rows={3}
              value={item.body}
              onChange={e => onEdit({ body: e.target.value })}
            />
          </ItemField>
          <ItemField label={t('item.field.notes')}>
            <textarea
              className={css.itemInput}
              rows={2}
              value={item.notes}
              onChange={e => onEdit({ notes: e.target.value })}
            />
          </ItemField>
          <div className={css.itemFieldRow}>
            <ItemField label={t('item.field.status')}>
              {/* The select shows the DERIVED state, not the stored one. The row
                  header groups by "in progress" while the stored value says
                  "to do", and two panels disagreeing inside one card reads as
                  a bug. So the control says what the reader sees, and the line
                  under it says why the two can differ. */}
              <select
                className={css.itemInput}
                value={status}
                onChange={e => onEdit({ status: storedStatusFor(e.target.value) })}
              >
                {(['inProgress', ...ITEM_STATUSES] as const).map(option => (
                  <option key={option} value={option}>{t(GROUP_KEYS[option])}</option>
                ))}
              </select>
            </ItemField>
            <ItemField label={t('item.field.priority')}>
              <select
                className={css.itemInput}
                value={item.priority}
                onChange={e => onEdit({ priority: e.target.value as ItemRecord['priority'] })}
              >
                {ITEM_PRIORITIES.map(priority => <option key={priority} value={priority}>{t(PRIORITY_KEYS[priority])}</option>)}
              </select>
            </ItemField>
          </div>
          {status === 'inProgress' && (
            <p className={css.itemHint}>{t('item.status.derived')}</p>
          )}
          <div className={css.itemFieldRow}>
            <ItemField label={t('item.field.startsAfter')}>
              <input
                type="date"
                className={css.itemInput}
                value={toItemDateField(item.startsAfter)}
                onChange={e => onEdit({ startsAfter: parseItemDate(e.target.value) })}
              />
            </ItemField>
            <ItemField label={t('item.field.dueAt')}>
              <input
                type="date"
                className={css.itemInput}
                value={toItemDateField(item.dueAt)}
                onChange={e => onEdit({ dueAt: parseItemDate(e.target.value) })}
              />
            </ItemField>
            <ItemField label={t('item.field.hardDueAt')}>
              <input
                type="date"
                className={css.itemInput}
                value={toItemDateField(item.hardDueAt)}
                onChange={e => onEdit({ hardDueAt: parseItemDate(e.target.value) })}
              />
            </ItemField>
          </div>
          <ItemField label={t('item.field.tags')}>
            <input
              className={css.itemInput}
              value={item.tags.join('、')}
              placeholder={t('item.field.tagsHint')}
              onChange={e => onEdit({ tags: e.target.value.split(/[、,]/).map(tag => tag.trim()).filter(tag => tag !== '') })}
            />
          </ItemField>
          <ItemField label={t('item.field.taskId')}>
            <select
              className={css.itemInput}
              value={item.taskId ?? ''}
              onChange={e => onEdit({ taskId: e.target.value === '' ? undefined : e.target.value })}
            >
              <option value="">{t('item.field.noCard')}</option>
              {cards.map(card => (
                <option key={card.id} value={card.id}>{card.title}</option>
              ))}
            </select>
          </ItemField>
          {item.taskId !== undefined && (
            <p className={css.itemHint}>
              {linkedCardTitle === undefined
                ? t('item.field.cardGone')
                : t('item.field.linked', { title: linkedCardTitle })}
            </p>
          )}
          <div className={css.itemActions}>
            <Chip kind={item.origin.source === 'ai' ? 'warn' : 'muted'}>
              {t(ORIGIN_KEYS[item.origin.source])}
            </Chip>
            <Button variant="dangerGhost" onClick={onRemove}>{t('item.remove')}</Button>
          </div>
        </div>
      )}
    </li>
  )
}

/** The stored value behind a status the reader picked. */
export function storedStatusFor(picked: string): ItemRecord['status'] {
  return picked === 'inProgress' ? 'open' : picked as ItemRecord['status']
}

/** One labelled field; the label is the control's name, not decoration. */
function ItemField(props: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <label className={css.itemField}>
      <span className={css.itemFieldLabel}>{props.label}</span>
      {props.children}
    </label>
  )
}

/**
 * The page body.
 * @param props - the slot's tab hook and the injected face.
 * @returns the list, its degraded state, or its loading state.
 */
export function ItemListPanel(props: ItemListPanelProps) {
  const { face } = props
  const replica = face.replica
  const [items, setItems] = useState<readonly ItemRecord[]>(() => replica?.view() ?? [])
  const [filter, setFilter] = useState<ItemFilter>(NO_ITEM_FILTER)
  const [openRow, setOpenRow] = useState<string | undefined>(undefined)
  const [collapsed, setCollapsed] = useState<ReadonlySet<ItemGroup>>(() => new Set())
  const [density, chooseDensity] = useDensity()
  const [now, setNow] = useState(() => Date.now())
  const english = isEnglish()
  const seen = useRef<Set<string>>(new Set())
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set())

  // The replica is the only source of the list; a rebuild shows up here. A
  // replica that is gone empties the view, which is what "there is nothing to
  // read here" honestly looks like.
  useEffect(() => {
    if (replica === undefined) {
      setItems([])
      return
    }
  }, [replica])

  // Our own lifetime, handed down by the drawer that owns this panel. The
  // minute clock hangs on it, so the clock cannot outlive the surface that
  // started it — the discipline a resource outliving its owner breaks.
  const lifetime = props.signal

  // Deadlines age in front of the reader, and only while the panel is on
  // screen: a clock ticking for a surface nobody is looking at spends the
  // reader's battery on a picture they cannot see.
  useEffect(() => {
    const tick = (): void => setNow(Date.now())
    const timer = window.setInterval(tick, 60_000)
    const stop = (): void => window.clearInterval(timer)
    lifetime.addEventListener('abort', stop, { once: true })
    return () => {
      stop()
      lifetime.removeEventListener('abort', stop)
    }
  }, [lifetime])

  // The arrival flash is a moment, not a state — and it is not a moment the
  // reader misses behind another tab.
  useEffect(() => {
    if (fresh.size === 0) return
    const timer = window.setTimeout(() => setFresh(new Set()), 900)
    return () => window.clearTimeout(timer)
  }, [fresh])

  const controller = face.controller
  const running = useMemo(
    () => runningMapOf(face),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the snapshot changes drive it
    [controller, items],
  )

  // The cards a note may hang off. One list, read from the board — the list is
  // never assembled here, so a card that appears on the board appears here in
  // the same breath.
  const cards = useMemo<readonly { readonly id: string; readonly title: string }[]>(
    () => (controller?.getSnapshot().tasks ?? [])
      .map(task => ({ id: task.id, title: task.title.trim() === '' ? task.description.trim().slice(0, 40) : task.title.trim() }))
      .filter(card => card.title !== ''),
    [controller, items],
  )

  const lostHost = replica?.hostLostItems() === true
  const syncing = replica !== undefined && !lostHost && !replica.isSynced()
  const filtering = filter.text.trim() !== '' || filter.groups.length > 0
  const slices = useMemo(
    () => itemGroupSlicesOf(items, filter, running),
    [items, filter, running],
  )

  const apply = useCallback((next: readonly ItemRecord[]) => {
    if (next === items) return
    setItems(next)
    replica?.setItems(next)
  }, [items, replica])

  const shown = useMemo(
    () => slices.reduce((total, slice) => total + slice.items.length, 0),
    [slices],
  )

  // The first read establishes what was ALREADY there. Only rows that arrive
  // after that are new arrivals — otherwise every row flashes on open, and a
  // flash that always fires stops meaning anything at all.
  const seeded = useRef(false)
  useEffect(() => {
    if (replica === undefined) return
    const read = () => {
      const next = replica.view()
      setItems(next)
      if (!seeded.current) {
        for (const item of next) seen.current.add(item.id)
        seeded.current = true
        return
      }
      const arrived = new Set<string>()
      for (const item of next) {
        if (!seen.current.has(item.id)) arrived.add(item.id)
        seen.current.add(item.id)
      }
      if (arrived.size > 0) setFresh(arrived)
    }
    read()
    return replica.onRemote(read)
  }, [replica])

  const [draft, setDraft] = useState({ title: '', body: '', notes: '' })
  const commitDraft = useCallback(() => {
    const result = addItem(items, {
      title: draft.title,
      body: draft.body,
      notes: draft.notes,
      status: 'open',
      priority: 'normal',
    }, Date.now())
    // A refusal changes nothing AND keeps the words, so the reader can finish
    // the thought instead of losing it to a disabled button's surprise.
    if (result.added === undefined) return
    apply(result.items)
    setDraft({ title: '', body: '', notes: '' })
  }, [apply, draft, items])

  // The composer lives in the header so it is reachable with the list on screen
  // AND with an empty list on screen: an entry point that only appears when
  // there is nothing to edit is an entry point you cannot find.
  const composer = (
    <div className={css.itemComposer}>
      <input
        className={css.itemInput}
        value={draft.title}
        placeholder={t('item.composeTitle')}
        aria-label={t('item.composeTitle')}
        onChange={e => setDraft({ ...draft, title: e.target.value })}
        onKeyDown={e => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
          e.preventDefault()
          commitDraft()
        }}
      />
      <Button
        variant="primary"
        size="sm"
        onClick={commitDraft}
        disabled={draft.title.trim() === '' && draft.body.trim() === ''}
      >
        {t('item.composeAdd')}
      </Button>
    </div>
  )

  if (replica === undefined) {
    return (
      <div className={css.itemRoot} data-dsh-taskboard-view="">
        <p className={css.itemState} role="status">{t('item.loading')}</p>
      </div>
    )
  }

  return (
    <div className={css.itemRoot} data-dsh-taskboard-view="">
      <header className={css.itemHeader}>
        <input
          className={css.itemSearch}
          value={filter.text}
          placeholder={t('item.search')}
          aria-label={t('item.search')}
          onChange={e => setFilter({ ...filter, text: e.target.value })}
        />
        <div className={css.itemFilterRow}>
          {ITEM_GROUPS.map(group => {
            const on = filter.groups.includes(group)
            return (
              <Button
                key={group}
                variant="ghost"
                size="sm"
                pressed={on}
                onClick={() => setFilter({
                  ...filter,
                  groups: on ? filter.groups.filter(g => g !== group) : [...filter.groups, group],
                })}
              >
                {groupLabel(group)}
              </Button>
            )
          })}
        </div>
        <div className={css.itemHeaderRow}>
          {/* Two numbers, because "showing 2" and "of 40" are different facts
              and one of them alone is how a filter looks like it did nothing. */}
          <p className={css.itemCount} aria-live="polite">
            {filtering
              ? t('item.countFiltered', { shown: String(shown), total: String(items.length) })
              : t('item.count', { n: String(items.length) })}
          </p>
          <SegmentedDensity value={density} onChange={chooseDensity} />
        </div>
        {composer}
      </header>

      {/* Reading in-flight and unreachable are different facts, and NEITHER one
          hides the list: the local mirror is whole and usable, so covering it
          would be a worse answer than a banner. */}
      {lostHost && <p className={css.itemState} role="status">{t('item.hostLost')}</p>}
      {!lostHost && syncing && <p className={css.itemState} role="status">{t('item.syncing')}</p>}

      {items.length === 0 && (
        <p className={css.itemState}>{t('item.empty')}</p>
      )}

      {items.length > 0 && shown === 0 && (
        <p className={css.itemState}>{t('item.noMatch')}</p>
      )}

      {items.length > 0 && shown > 0 && (
        <div className={css.itemScroll}>
          {slices.map(slice => {
            const isCollapsed = collapsed.has(slice.group)
              ? true
              : !groupOpenByDefault(slice.group, filtering)
            return (
              <section key={slice.group} className={css.itemGroup}>
                <h2 className={css.itemGroupHead}>
                  <button
                    type="button"
                    className={css.itemGroupToggle}
                    aria-expanded={!isCollapsed}
                    aria-controls={`${slice.group}-body`}
                    onClick={() => setCollapsed(prev => {
                      const next = new Set(prev)
                      if (next.has(slice.group)) next.delete(slice.group)
                      else next.add(slice.group)
                      return next
                    })}
                  >
                    <Icon name="chevronDown" className={css.itemGroupChevron} />
                    {groupLabel(slice.group)}
                    <span className={css.itemGroupCount}>{slice.items.length}</span>
                  </button>
                </h2>
                {!isCollapsed && (
                  <ul className={css.itemList} id={`${slice.group}-body`}>
                    {slice.items.map(item => (
                      <ItemRow
                        key={item.id}
                        view={itemRowViewOf(item, running.get(item.taskId ?? '') === true, now)}
                        density={density}
                        english={english}
                        expanded={openRow === item.id}
                        fresh={fresh.has(item.id)}
                        panelId="item"
                        onToggle={() => setOpenRow(openRow === item.id ? undefined : item.id)}
                        onEdit={edit => apply(editItem(items, item.id, edit, Date.now()))}
                        onToggleStep={stepId => apply(toggleItemStep(items, item.id, stepId, Date.now()))}
                        onRemove={() => apply(removeItem(items, item.id))}
                        cards={cards}
                        linkedCardTitle={item.taskId === undefined ? undefined : cards.find(c => c.id === item.taskId)?.title}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The density switch: a real control, because a fixed density is a fight. */
function SegmentedDensity(props: { readonly value: ItemDensity; readonly onChange: (next: ItemDensity) => void }) {
  return (
    <div className={css.itemDensity} role="group" aria-label={t('item.density')}>
      {(['compact', 'comfy'] as const).map(density => (
        <Button
          key={density}
          variant="ghost"
          size="sm"
          pressed={props.value === density}
          onClick={() => props.onChange(density)}
        >
          {t(DENSITY_KEYS[density])}
        </Button>
      ))}
    </div>
  )
}
