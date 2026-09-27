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
import { t } from '../locales.ts'
import { Button, Icon } from '../board/ui.tsx'
import { Chip } from '../board/Chip.tsx'
import {
  editItem,
  groupOpenByDefault,
  itemGroupSlicesOf,
  itemRowViewOf,
  NO_ITEM_FILTER,
  readItemDensity,
  removeItem,
  toggleItemStep,
  writeItemDensity,
  type ItemDensity,
  type ItemEdit,
  type ItemFilter,
  type ItemGroup,
} from './model.ts'
import type { ItemListFace } from './register.tsx'
import css from '../board.module.css'

/** The panel's props: the slot's own tab hook plus the face we inject. */
export interface ItemListPanelProps {
  useTabInfo: () => unknown
  face: ItemListFace
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
  return t(`item.group.${group}` as Parameters<typeof t>[0])
}

/** One row of the list. Clicking it opens level 1 in place. */
function ItemRow(props: {
  readonly view: ReturnType<typeof itemRowViewOf>
  readonly density: ItemDensity
  readonly expanded: boolean
  readonly fresh: boolean
  readonly panelId: string
  readonly onToggle: () => void
  readonly onEdit: (edit: ItemEdit) => void
  readonly onToggleStep: (stepId: string) => void
  readonly onRemove: () => void
}) {
  const { view, density, expanded, fresh, panelId, onToggle, onEdit, onToggleStep, onRemove } = props
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
        <span className={css.itemRef}>{ref}</span>
        <span className={css.itemTitle}>{title}</span>
        {meta.kind === 'due' && (
          <span className={css.itemDue} data-overdue={meta.overdue ? '' : undefined} data-hard={meta.hard ? '' : undefined}>
            {t(meta.overdue ? 'item.due.overdue' : 'item.due.upcoming', { when: new Date(meta.at).toLocaleDateString() })}
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
              <select
                className={css.itemInput}
                value={item.status}
                onChange={e => onEdit({ status: e.target.value as ItemRecord['status'] })}
              >
                {ITEM_STATUSES.map(status => <option key={status} value={status}>{t(`item.status.${status}` as Parameters<typeof t>[0])}</option>)}
              </select>
            </ItemField>
            <ItemField label={t('item.field.priority')}>
              <select
                className={css.itemInput}
                value={item.priority}
                onChange={e => onEdit({ priority: e.target.value as ItemRecord['priority'] })}
              >
                {ITEM_PRIORITIES.map(priority => <option key={priority} value={priority}>{t(`item.priority.${priority}` as Parameters<typeof t>[0])}</option>)}
              </select>
            </ItemField>
          </div>
          <div className={css.itemActions}>
            <Chip kind={item.origin.source === 'ai' ? 'warn' : 'muted'}>
              {t(`item.origin.${item.origin.source}` as Parameters<typeof t>[0])}
            </Chip>
            <Button variant="dangerGhost" onClick={onRemove}>{t('item.remove')}</Button>
          </div>
        </div>
      )}
    </li>
  )
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
  const seen = useRef<Set<string>>(new Set())
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set())

  // The replica is the only source of the list; a rebuild shows up here.
  useEffect(() => {
    if (replica === undefined) {
      setItems([])
      return
    }
    const read = () => {
      const next = replica.view()
      setItems(next)
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

  // Deadlines age in front of the reader; nothing else does.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // The arrival flash is a moment, not a state.
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
          {(['inProgress', 'open', 'blocked', 'done'] as const).map(group => {
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
          <p className={css.itemCount} aria-live="polite">{t('item.count', { n: String(items.length) })}</p>
          <SegmentedDensity value={density} onChange={chooseDensity} />
        </div>
      </header>

      {/* Reading in-flight and unreachable are different facts and say so. */}
      {lostHost && <p className={css.itemState} role="status">{t('item.hostLost')}</p>}
      {!lostHost && syncing && <p className={css.itemState} role="status">{t('item.syncing')}</p>}
      {!lostHost && !syncing && items.length === 0 && (
        <p className={css.itemState}>{t('item.empty')}</p>
      )}

      {!lostHost && items.length > 0 && (
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
                        expanded={openRow === item.id}
                        fresh={fresh.has(item.id)}
                        panelId="item"
                        onToggle={() => setOpenRow(openRow === item.id ? undefined : item.id)}
                        onEdit={edit => apply(editItem(items, item.id, edit, Date.now()))}
                        onToggleStep={stepId => apply(toggleItemStep(items, item.id, stepId, Date.now()))}
                        onRemove={() => apply(removeItem(items, item.id))}
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
          {t(`item.density.${density}` as Parameters<typeof t>[0])}
        </Button>
      ))}
    </div>
  )
}
