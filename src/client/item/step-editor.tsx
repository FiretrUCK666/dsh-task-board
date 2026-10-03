/**
 * The checklist editor: type a line, take one off, move one up or down.
 *
 * WHY IT IS IN THE DETAIL PANE AND NOT IN THE ROW MENU. The menu is a MENU — a
 * list of things a row can be made to do, one press each, and it closes. An editor
 * is a form: a field to type into, four controls per line, and a caret that has
 * to STAY somewhere while the reader types. Putting a form inside a menu means
 * the menu is either modal over the rows (a dialog, and this surface has none) or
 * a floating box that closes on the first outside click — which is the first
 * keystroke of a half-typed step. So the menu's 「编辑步骤」 OPENS this, and the
 * editing happens where the steps are already drawn and already readable.
 *
 * WHICH IS ALSO WHY THE HAND-OFF IS A COUNTER AND NOT A REF. The panel owns the
 * row and the detail is drawn in one of two places (in the row on the phone, in
 * the rail on a desk), so a parent reaching into whichever one mounted would be a
 * parent that has to know which. A bumped counter is the same request the capture
 * box already takes, for the same reason: the gesture is 「写点什么」, so that is
 * what the panel asks for.
 *
 * EVERY CONTROL IS A REAL BUTTON WITH A NAME, not a drag handle. Reordering by
 * dragging is the faster gesture on a desk and it is unavailable to a thumb and
 * to a keyboard, and it is unavailable to a screen reader entirely — so it is not
 * the only way, and here it is not a way at all. Two labelled presses move a line
 * one place each, which every input device already knows how to do.
 */
import { useEffect, useRef, useState } from 'react'
import type { ItemRecord } from '../../core/item.ts'
import { t } from '../locales.ts'
import { Button } from '../board/ui.tsx'
import css from './item.module.css'
import boardCss from '../board.module.css'

/**
 * ONE GHOST BUTTON, SPELLED OUT.
 *
 * It is the same two classes the board's `Button` would have put on it, and it is
 * written out rather than imported for one reason: **this control's name is the
 * only thing that says which step it acts on**, and `Button` does not forward an
 * `aria-label` — it is accepted in the props and dropped, so the name never reaches
 * the element. Three controls per step, all reading 「往上挪一步」, is a checklist
 * nobody can operate without a mouse to hover with.
 *
 * The classes are the board's own, so this is a composition and not a second
 * variant table: when `Button` grows `aria-label` (one prop, one attribute), this
 * file goes back to `Button` and the surface is unchanged.
 * @param tone - `ghost` for a move, `danger` for the one that takes work away.
 * @returns the class list, and the props every one of these buttons shares.
 */
function stepButton(tone: 'ghost' | 'danger'): { className: string; type: 'button' } {
  return {
    type: 'button',
    className: `${tone === 'danger' ? boardCss.dangerGhostButton : boardCss.ghostButton} ${boardCss.buttonSm}`,
  }
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
 * @returns the list, then the field that adds to it.
 */
export function ItemSteps(props: ItemStepsProps) {
  const [draft, setDraft] = useState('')
  const field = useRef<HTMLInputElement | null>(null)
  const { steps } = props.item

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

  return (
    <>
      {steps.length === 0
        ? <p className={css.itemHint}>{t('item.steps.empty')}</p>
        : (
          <ul className={css.itemStepList}>
            {steps.map((step, at) => (
              <li key={step.id} className={css.itemStep}>
                <div className={css.itemStepMain}>
                  <label>
                    <input
                      type="checkbox"
                      checked={step.done}
                      aria-label={step.text}
                      onChange={() => props.onToggle(step.id)}
                    />
                    <span data-done={step.done ? '' : undefined}>{step.text}</span>
                  </label>
                </div>
                {/* 三个控件，顺序是从最常用排到最不常用：去掉在最后，因为它不可撤销，
                    而读者点错它的次数比点错「挪上去」多得多。
                    每一个都带着**这一步的名字**——不是「↑」，也不是「往上挪一步」：
                    一份五步的清单上有十四个这样的控件，只有名字能告诉读者哪一个是
                    哪一个。 */}
                <div className={css.itemStepActions}>
                  <button
                    {...stepButton('ghost')}
                    disabled={at === 0}
                    aria-label={`${t('item.steps.up')}：${step.text}`}
                    title={`${t('item.steps.up')}：${step.text}`}
                    onClick={() => props.onMove(step.id, -1)}
                  >
                    <span aria-hidden="true">↑</span>
                  </button>
                  <button
                    {...stepButton('ghost')}
                    disabled={at === steps.length - 1}
                    aria-label={`${t('item.steps.down')}：${step.text}`}
                    title={`${t('item.steps.down')}：${step.text}`}
                    onClick={() => props.onMove(step.id, 1)}
                  >
                    <span aria-hidden="true">↓</span>
                  </button>
                  <button
                    {...stepButton('danger')}
                    aria-label={`${t('item.steps.remove')}：${step.text}`}
                    title={`${t('item.steps.remove')}：${step.text}`}
                    onClick={() => props.onRemove(step.id)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      <div className={css.itemStepsAdd}>
        <input
          ref={field}
          className={css.itemInput}
          value={draft}
          placeholder={t('item.steps.placeholder')}
          aria-label={t('item.steps.placeholder')}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            // An IME composition owns Enter while it is running: adding there would
            // file half a word and swallow the keystroke that chose it.
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            add()
          }}
        />
        <Button variant="ghost" size="sm" onClick={add} disabled={draft.trim() === ''}>
          {t('item.steps.add')}
        </Button>
      </div>
    </>
  )
}
