/**
 * ONE PLACE TO WRITE A PARAGRAPH, AND THERE IS ONLY ONE OF IT.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * This panel writes prose in five places: the detail's 正文 和 上下文备注, and
 * the new-row sheet's 正文 和 步骤 和 上下文备注. They are ONE control, because a
 * reader who learns how to write in one of them has learned all five — and
 * because a change made to one is otherwise invisible in the others. That is what
 * 「各搞一套」 looks like in a codebase. `tests/panel-render.spec.ts` asserts
 * that no `<textarea>` exists anywhere else under `src/client/item/`, so a
 * second one cannot appear.
 *
 * ── THE HEIGHT BELONGS TO THE READER ─────────────────────────────────────────
 *
 * The height is FIXED, the text scrolls inside, and the drag zone is the WHOLE
 * BOTTOM EDGE — a real, drawn, always-visible band. Nothing about the content
 * decides it: `field-sizing` and the browser's own `resize` are both off, because
 * a box whose height is a function of its content cannot also be a box the reader
 * sized. The floor and the ceiling are the stylesheet's `min-block-size` /
 * `max-block-size` and they are READ BACK off the element rather than repeated
 * here, so the gesture cannot disagree with the layout it is changing.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────
 *
 * No `rows` attribute and no auto-grow: a box whose height is a function of its
 * content cannot also be a box the reader sized. No `::-webkit-resizer` rules
 * either — `resize` is `none` now, and a rule hiding a platform affordance this
 * box never draws describes a browser rather than this page.
 *
 * The one number a keyboard needs — one line — is read from the box's own
 * computed `line-height`; when there is no layout at all (jsdom, where every spec
 * runs) that read comes back empty and a keyboard resize does nothing. That is
 * why the keyboard and the drag are measured in a real browser by
 * `scripts/shot-panel.mjs`: geometry on this surface is measured, never asserted
 * out of a document (hard rule 19).
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { t } from '../locales.ts'
import css from './item.module.css'

/**
 * The custom property the drag writes. The NAME appears here and in the
 * stylesheet — a custom property is a contract between the two, so its name is
 * the one thing that has to be spelled twice; its VALUE never is.
 */
const PROSE_HEIGHT = '--item-prose-h'

/** What a reader's writing box needs from its surface. */
interface ProseFieldProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder: string
  readonly ariaLabel: string
  /**
   * The height this reader last dragged a box to, in px.
   *
   * `undefined` while nobody has ever dragged one, and that is the honest state
   * rather than a default: the stylesheet's own starting height is what a box
   * nobody sized is drawn at, and writing that number into storage would freeze
   * a layout decision into a reader's preference file.
   */
  readonly height?: number
  /**
   * ONE SETTLED SIZE, ONCE PER GESTURE.
   *
   * A drag reports on release, a keystroke on the press. Reporting every
   * `pointermove` would write a preference sixty times a second for a number
   * nobody reads until the gesture is over.
   */
  readonly onHeight?: (px: number) => void
  /** Take the caret when the box appears. */
  readonly takeCaret?: boolean
}

/**
 * One writing box.
 * @param props - the text, the words it wears, and where its size goes.
 * @returns the box, its whole-bottom-edge grip, and nothing else.
 */
export function ProseField(props: ProseFieldProps) {
  const field = useRef<HTMLTextAreaElement | null>(null)
  const drag = useRef<{ readonly from: number; readonly height: number } | undefined>(undefined)
  /**
   * The live height, beside the state that draws it.
   *
   * The handlers read THIS and not the state, because a pointer move is a
   * continuous event and React is free to batch a frame of them: a drag that
   * read the last committed render would lag its own pointer by a frame, and a
   * release that read it could write a size the reader had already passed
   * through. The state is for drawing and for assistive technology; the ref is
   * for arithmetic.
   */
  const live = useRef<number | undefined>(props.height)
  const [height, setHeight] = useState<number | undefined>(props.height)
  /**
   * The floor and the ceiling, read off the layout ONCE, because both are fixed
   * lengths declared in the stylesheet — they do not answer to the panel's width,
   * so there is nothing to re-read on a resize.
   */
  const [bounds, setBounds] = useState<{ readonly min: number; readonly max: number } | undefined>(undefined)

  useEffect(() => {
    const node = field.current
    if (node === null) return
    const style = getComputedStyle(node)
    const min = parseFloat(style.getPropertyValue('min-block-size'))
    const max = parseFloat(style.getPropertyValue('max-block-size'))
    if (!Number.isFinite(min) && !Number.isFinite(max)) return
    setBounds({
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : Number.MAX_SAFE_INTEGER,
    })
  }, [])

  /* The remembered size can arrive after the mount — a box opened on a row, a
   * preference read later — so the state follows the prop. It only runs when the
   * value actually changes, so it can never fight a drag in progress. */
  useEffect(() => {
    live.current = props.height
    setHeight(props.height)
  }, [props.height])

  /* THE CARET COMES WITH THE BOX, AND THE PANEL DOES NOT MOVE.
   *
   * `preventScroll` is not a micro-optimisation. The box appears where the reader
   * just pressed, so it is already on screen; a focus that scrolls the panel to
   * "centre" a box the reader is looking at moves the page out from under them.
   * It also keeps the box's appearance from being a scroll event. */
  useEffect(() => {
    if (props.takeCaret !== true) return
    field.current?.focus({ preventScroll: true })
  }, [props.takeCaret])

  /** What the box is drawn at right now, as far as this component can know. */
  const current = (): number => live.current ?? bounds?.min ?? field.current?.getBoundingClientRect().height ?? 0

  const clamp = (px: number): number => {
    const min = bounds?.min ?? 0
    const max = bounds?.max ?? Number.MAX_SAFE_INTEGER
    return Math.min(Math.max(px, min), max)
  }

  /** Draw it, and remember it as the live value. No write to storage yet. */
  const resize = (px: number): void => {
    const next = Math.round(clamp(px))
    live.current = next
    setHeight(next)
  }

  const onGripDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // The press belongs to the grip: without this the pointer would start a
    // text selection inside the box the grip is attached to.
    event.preventDefault()
    drag.current = { from: event.clientY, height: current() }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onGripMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const started = drag.current
    if (started === undefined) return
    /* A MOVE THAT MOVED NOTHING IS NOT A RESIZE. Without this, pressing the grip
     * and letting go writes the box's current height back onto it as an inline
     * size — the same number, so nothing looks wrong, but the box now carries a
     * size the reader never chose, and the first thing anybody debugging 「why is
     * this box no longer at the default height」 has to do is work out where that
     * number came from. */
    const moved = event.clientY - started.from
    if (moved === 0) return
    resize(started.height + moved)
  }

  const onGripUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const started = drag.current
    if (started === undefined) return
    drag.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    /* A PRESS THAT MOVED NOTHING WRITES NOTHING. Dragging a box away and back, or
     * simply pressing the grip, must not turn the stylesheet's starting height
     * into a stored preference — the store is for sizes the reader chose. */
    if (live.current !== undefined && live.current !== started.height) props.onHeight?.(live.current)
  }

  /* ONE LINE PER PRESS. The step is the box's own line-height — the unit the
   * reader is already reading in — rather than a number chosen here. */
  const onGripKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    const node = field.current
    if (node === null) return
    const line = parseFloat(getComputedStyle(node).lineHeight)
    if (!Number.isFinite(line) || line <= 0) return
    event.preventDefault()
    const before = current()
    resize(before + (event.key === 'ArrowDown' ? line : -line))
    if (live.current !== undefined && live.current !== before) props.onHeight?.(live.current)
  }

  const style = height === undefined ? undefined : ({ [PROSE_HEIGHT]: `${height}px` } as CSSProperties)

  return (
    <div className={css.itemProseBox} style={style}>
      {/* `data-dsh-tb-scroll` mounts the shared scroll grammar (mechanism and the
          reason its track is inset at both ends: board.module.css, 「HOW A SECOND
          PANEL MOUNTS THIS GRAMMAR」). Unmounted, this box drew the raw platform
          bar — a full-height track whose ends run into the rounded corner, which
          reads as a bar breaking through the top edge. */}
      <textarea
        ref={field}
        className={css.itemProse}
        data-dsh-tb-scroll=""
        value={props.value}
        placeholder={props.placeholder}
        aria-label={props.ariaLabel}
        onChange={event => props.onChange(event.target.value)}
      />
      {/* THE WHOLE BOTTOM EDGE IS THE HANDLE, and it is drawn: a control the
          reader cannot see is a control the reader does not know exists. Its
          keys are declared where every other field on this panel declares them,
          so the panel's keymap stands aside for them (hard rule 11③). */}
      <div
        className={css.itemProseGrip}
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('item.field.resize')}
        /* **范围永远在，哪怕还没量出来。** 一个可聚焦的 `separator` 是「分隔条」这个
           控件，规范要求它带一个值；而 `bounds` 的初值是 `undefined`（那是第一次测量
           之前的那一帧），于是早先那版**到那一刻就把三个值一起省掉**——留下一个
           「读屏说不出它在哪一档」的可聚焦控件。它也不能靠退出 Tab 序来躲：抓条够不着
           就是键盘够不着（`item-workbench.spec` 钉着这一条）。
           所以这三个值读的是**拖动自己用的那两个地板**（`onGripMove` 里 `min`/`max`
           的兜底就是这两个数）：读屏听到的范围与这个控件真能做的事完全一致。 */
        aria-valuemin={bounds?.min ?? 0}
        aria-valuenow={height ?? bounds?.min ?? 0}
        aria-valuemax={bounds?.max ?? Number.MAX_SAFE_INTEGER}
        tabIndex={0}
        data-dsh-tb-keys="ArrowUp ArrowDown"
        {...(bounds === undefined ? {} : { 'aria-valuemin': bounds.min, 'aria-valuenow': height ?? bounds.min, 'aria-valuemax': bounds.max })}
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={onGripUp}
        onKeyDown={onGripKey}
      >
        <span aria-hidden="true" />
      </div>
    </div>
  )
}
