/**
 * The checklist, drawn as a BOARD and not as a form.
 *
 * ── WHY A BOARD AND NOT A LIST OF CHECKBOXES ─────────────────────────────────
 *
 * A checklist is not a list of booleans; it is 「还有多少没做」 and 「下一件是哪
 * 一件」. A flat list answers neither: at thirty steps the reader scrolls past
 * twenty-nine finished lines to reach the one they have to do, and at a hundred
 * steps the panel carries three hundred controls, two hundred of them on rows
 * nobody is looking at.
 *
 * So the board says both facts once — a bar that is how far along it is, and the
 * same fact in digits — then **the next step alone**, then what is waiting, then a
 * fold for what is already done. A hundred steps is a hundred steps of *work*; it
 * is never a hundred rows of *screen*.
 *
 * ── WHY THE COUNT AND THE BAR NEVER DESCRIBE WHAT IS DRAWN ───────────────────
 *
 * Both read `item.steps`. What is on screen is a READING of that list rather than a
 * second list: if the bar were computed from the drawn rows, a folded row would
 * stop existing, and 「2 / 40」 beside one visible row would be an arithmetic
 * accident rather than a fact.
 *
 * ── WHY EVERY CONTROL IS A NAMED BUTTON ─────────────────────────────────────
 *
 * Reordering by dragging is the faster gesture on a desk and it is unavailable to
 * a thumb, to a keyboard and to a screen reader entirely — so it is not here at
 * all. Moving and removing live in ONE ⋯ on the step itself, because three always
 * visible buttons per row is three controls times a hundred rows, and no thumb can
 * aim at the middle third of a long list of small buttons.
 */
import { useEffect, useRef, useState } from 'react'
import type { ItemRecord, ItemStep } from '../../core/item.ts'
import { t } from '../locales.ts'
import { Button } from '../board/ui.tsx'
import { ItemRowMenu } from './row-menu.tsx'
import { Tickbox } from './tickbox.tsx'
import css from './item.module.css'

/**
 * HOW MANY WAITING STEPS ARE DRAWN BEFORE THE REST GO BEHIND A LINE.
 *
 * Six is a reading rather than a measurement: about how many one-sentence steps
 * fit above the fold on the narrowest board this surface runs on, with the count
 * and the bar still in sight. It is named because a fold the reader sees on every
 * row is a fold they learn; a literal typed into the comparison would be the same
 * number today and an unexplainable one tomorrow.
 */
const WAITING_VISIBLE = 6

/** What every drawn step is handed, so the board and the fold share one row. */
interface RowHands {
  readonly openMenu: string | undefined
  readonly onToggleMenu: (stepId: string) => void
  readonly onToggle: (stepId: string) => void
  readonly onMove: (stepId: string, by: -1 | 1) => void
  readonly onRemove: (stepId: string) => void
}

export interface ItemStepsProps {
  /** The row being edited. Its `id` is what a new step's id is derived from. */
  readonly item: ItemRecord
  /** Bumped by 「编辑步骤」; the field takes the caret when it changes. */
  readonly focusRequest?: number
  readonly onToggle: (stepId: string) => void
  readonly onAdd: (text: string) => void
  readonly onRemove: (stepId: string) => void
  readonly onMove: (stepId: string, by: -1 | 1) => void
}

/**
 * The checklist.
 * @param props - the row, the focus request and the four hand-offs.
 * @returns the board, then the field that adds to it.
 */
export function ItemSteps(props: ItemStepsProps) {
  const [draft, setDraft] = useState('')
  const [openMenu, setOpenMenu] = useState<string | undefined>(undefined)
  /* THE WAITING FOLD IS A REAL DOOR, not a caption: the steps beyond the visible
   * six exist only behind it, so a press must be able to open it. Same shape as
   * the done fold below — one mark that turns, `aria-expanded`, one state. */
  const [moreOpen, setMoreOpen] = useState(false)
  const field = useRef<HTMLInputElement | null>(null)
  const steps = props.item.steps

  // The caret follows the request and NOTHING else, so a re-render caused by the
  // step the reader just added does not yank the caret out of a half-typed second
  // line. Watching `focusRequest` rather than the steps is the whole of it.
  useEffect(() => {
    if (props.focusRequest === undefined || props.focusRequest === 0) return
    field.current?.focus()
  }, [props.focusRequest])

  const add = (): void => {
    props.onAdd(draft)
    // 清掉的是输入框，不是列表：读者写完一步之后多半还要写下一步，而一个还留着
    // 上一句的框会让人以为那一句没存下去。
    setDraft('')
    field.current?.focus()
  }

  const hands: RowHands = {
    openMenu,
    // ONE MENU AT A TIME, and it opens on a press rather than staying open: a
    // hundred steps with a hundred open menus is a wall.
    onToggleMenu: id => setOpenMenu(current => (current === id ? undefined : id)),
    onToggle: props.onToggle,
    onMove: props.onMove,
    onRemove: props.onRemove,
  }

  const addField = <StepAdd draft={draft} setDraft={setDraft} onAdd={add} field={field} />

  if (steps.length === 0) {
    return (
      <>
        <p className={css.itemHint}>{t('item.steps.empty')}</p>
        {addField}
      </>
    )
  }

  const done = steps.filter(step => step.done)
  const waiting = steps.filter(step => !step.done)
  /** How many waiting steps stand behind the fold, whatever the fold's state is. */
  const beyond = waiting.length > WAITING_VISIBLE ? waiting.length - WAITING_VISIBLE : 0
  const shown = moreOpen || beyond === 0 ? waiting : waiting.slice(0, WAITING_VISIBLE)
  const percent = Math.round((done.length / steps.length) * 100)

  return (
    <>
      <div className={css.itemStepBoard}>
        <div className={css.itemStepGauges}>
          {/* The bar's width is the only number on this surface written as a
              percentage, and it is written here rather than in the stylesheet
              because it is the only thing on the page that is genuinely
              continuous. Every other count here is digits. */}
          <span className={css.itemStepBar} role="img" aria-label={t('item.steps.gauge', { done: String(done.length), total: String(steps.length) })}>
            <i style={{ inlineSize: `${percent}%` }} />
          </span>
          <b className={css.itemStepCount}>{`${done.length} / ${steps.length}`}</b>
        </div>

        <div id="item-steps-more">
          {shown.map((step, at) => (
            <StepRow key={step.id} step={step} kind={at === 0 ? 'next' : 'todo'} {...hands} onCloseMenu={() => setOpenMenu(undefined)} />
          ))}
        </div>
        {beyond > 0 && (
          <button
            type="button"
            className={css.itemStepFold}
            aria-expanded={moreOpen}
            aria-controls="item-steps-more"
            onClick={() => setMoreOpen(value => !value)}
          >
            <svg className={css.itemStepFoldMark} viewBox="0 0 8 8" width="8" height="8" aria-hidden="true">
              <path d="M2.6 1.8 L5.6 4.6 L2.6 7.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t(moreOpen ? 'item.steps.moreHide' : 'item.steps.more', { n: String(beyond) })}
          </button>
        )}
        {done.length > 0 && <DoneFold steps={done} {...hands} onCloseMenu={() => setOpenMenu(undefined)} />}
      </div>
      {addField}
    </>
  )
}

/** One step: a tick, the words, and a ⋯ that is only ever about THIS step. */
function StepRow(props: RowHands & {
  readonly step: ItemStep
  /** `next` marks the step the reader is supposed to be on. */
  readonly kind?: 'next' | 'todo'
  readonly onCloseMenu: () => void
}) {
  const { step } = props
  const open = props.openMenu === step.id
  const menuId = `item-menu-${step.id}`
  const trigger = useRef<HTMLButtonElement | null>(null)
  const row = useRef<HTMLDivElement | null>(null)
  return (
    <div ref={row} className={css.itemStepRow} data-kind={props.kind ?? 'todo'}>
      <Tickbox
        checked={step.done}
        label={t('item.steps.tick', { text: step.text })}
        onToggle={() => props.onToggle(step.id)}
      />
      {/* The words are in a box sized to the words. A strike painted on a box
          that fills the row is the reason a finished step's line used to run
          past the end of its own sentence and look like it went through
          something. */}
      <span className={css.itemStepWords} data-done={step.done ? '' : undefined}>
        {props.kind === 'next' && <b className={css.itemStepKind}>{t('item.steps.next')}</b>}
        {step.text}
      </span>
      <button
        ref={trigger}
        type="button"
        className={css.itemStepMenu}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${t('item.steps.moreMenu')}：${step.text}`}
        onClick={() => props.onToggleMenu(step.id)}
      >
        <svg viewBox="0 0 4 16" width="4" height="16" aria-hidden="true">
          <circle cx="2" cy="3" r="1.3" fill="currentColor" />
          <circle cx="2" cy="8" r="1.3" fill="currentColor" />
          <circle cx="2" cy="13" r="1.3" fill="currentColor" />
        </svg>
      </button>
      {open && (
        /* 与行上那个 ⋯ 不是同一个面板的两次实现，是**同一个面板**：竖排的
         * 菜单，锚在这枚 ⋯ 上，出格的行宽不归它自己管。《往上挪一步》那三
         * 枚横排药丸一趟铺满整行宽，看上去是一张表而不是一张菜单——两者的
         * 差别只有形状，而形状在这块面板上正在变成财力。 */
        <ItemRowMenu
          rowId={step.id}
          trigger={trigger.current}
          panel={row.current?.closest('[data-dsh-taskboard-view]') as HTMLElement | null ?? null}
          actions={[
            { key: 'up', label: t('item.steps.up'), onPick: () => props.onMove(step.id, -1) },
            { key: 'down', label: t('item.steps.down'), onPick: () => props.onMove(step.id, 1) },
            { key: 'remove', label: t('item.steps.remove'), onPick: () => props.onRemove(step.id) },
          ]}
          onClose={() => { props.onToggleMenu(step.id); props.onCloseMenu() }}
        />
      )}
    </div>
  )
}

/** The finished steps, behind one line that says how many there are. */
function DoneFold(props: RowHands & { readonly steps: readonly ItemStep[]; readonly onCloseMenu: () => void }) {
  const [open, setOpen] = useState(false)
  const id = 'item-steps-done'
  return (
    <div className={css.itemStepDone}>
      <button
        type="button"
        className={css.itemStepFold}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(value => !value)}
      >
        {/* THE DISCLOSURE MARK, drawn and turned by the state: the reader sees a
            control before they read a word, and the turn answers 「还能收吗」。 */}
        <svg className={css.itemStepFoldMark} viewBox="0 0 8 8" width="8" height="8" aria-hidden="true">
          <path d="M2.6 1.8 L5.6 4.6 L2.6 7.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t(open ? 'item.steps.doneHide' : 'item.steps.doneShow', { n: String(props.steps.length) })}
      </button>
      {open && (
        <div id={id}>
          {props.steps.map(step => (
            <StepRow key={step.id} step={step} kind="todo" {...props} onCloseMenu={props.onCloseMenu} />
          ))}
        </div>
      )}
    </div>
  )
}

/** The field that adds a step, and the button that refuses to file an empty one. */
function StepAdd(props: {
  readonly draft: string
  readonly setDraft: (value: string) => void
  readonly onAdd: () => void
  /* The ref is passed straight through to `ref=`, so its type is whatever `ref=`
   takes: the struct itself, not a `RefObject` whose `current` is nullable —
   `useRef<HTMLInputElement | null>(null)` returns exactly this shape. */
readonly field: { current: HTMLInputElement | null }
}) {
  return (
    <div className={css.itemStepsAdd}>
      <input
        ref={props.field}
        className={css.itemInput}
        value={props.draft}
        placeholder={t('item.steps.placeholder')}
        aria-label={t('item.steps.placeholder')}
        onChange={event => props.setDraft(event.target.value)}
        onKeyDown={event => {
          // An IME composition owns Enter while it is running: adding there would
          // file half a word and swallow the keystroke that chose it.
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          event.preventDefault()
          props.onAdd()
        }}
      />
      <Button variant="ghost" size="sm" onClick={props.onAdd} disabled={props.draft.trim() === ''}>
        {t('item.steps.add')}
      </Button>
    </div>
  )
}