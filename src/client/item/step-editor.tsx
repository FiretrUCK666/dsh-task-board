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
import { Tickbox } from './tickbox.tsx'
import css from './item.module.css'
import boardCss from '../board.module.css'

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
  const shown = waiting.slice(0, WAITING_VISIBLE)
  const hidden = waiting.length - shown.length
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

        {shown.map((step, at) => (
          <StepRow key={step.id} step={step} kind={at === 0 ? 'next' : 'todo'} {...hands} onCloseMenu={() => setOpenMenu(undefined)} />
        ))}
        {hidden > 0 && <p className={css.itemStepMore}>{t('item.steps.more', { n: String(hidden) })}</p>}
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
  const menuId = `item-step-menu-${step.id}`
  return (
    <div className={css.itemStepRow} data-kind={props.kind ?? 'todo'}>
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
        <ul id={menuId} className={css.itemStepMenuList} role="menu" aria-label={step.text}>
          <li>
            <button
              type="button"
              role="menuitem"
              className={`${boardCss.ghostButton} ${boardCss.buttonSm}`}
              onClick={() => { props.onMove(step.id, -1); props.onCloseMenu() }}
            >
              {t('item.steps.up')}
            </button>
          </li>
          <li>
            <button
              type="button"
              role="menuitem"
              className={`${boardCss.ghostButton} ${boardCss.buttonSm}`}
              onClick={() => { props.onMove(step.id, 1); props.onCloseMenu() }}
            >
              {t('item.steps.down')}
            </button>
          </li>
          <li>
            <button
              type="button"
              role="menuitem"
              className={`${boardCss.dangerGhostButton} ${boardCss.buttonSm}`}
              onClick={() => { props.onRemove(step.id); props.onCloseMenu() }}
            >
              {t('item.steps.remove')}
            </button>
          </li>
        </ul>
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