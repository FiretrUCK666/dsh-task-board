/**
 * Session context readout in the rail head: the session's live to-do list,
 * active goal and subagents — shown when the session HAS any of those, hidden
 * completely when it has none (a deterministic all-or-nothing rule, no
 * partial flicker).
 *
 * The TODO part is HARNESS-ISOMORPHIC: it reads the official `todos`
 * projection (the exact host-computed whole list the harness's own TodoPanel
 * renders), shows the same three status glyphs, the same per-status progress
 * counts in the header (zero segments omitted), the same default-collapsed
 * posture — so a harness upgrade flows in automatically and the board never
 * displays a second, drifting grammar.
 *
 * LAYOUT: one quiet header row (icon + title + progress summary + chevron) in
 * the rail head, and the expanded list is a POPOVER anchored under it —
 * absolute inside the rail, opaque menu surface, its own 45vh scroll region.
 * Expanding/modifying it can never push the context meter / session config /
 * comment thread away, and nothing clips it (the rail head's own scroll cap
 * cannot cut a floating panel).
 */
import { useEffect, useRef, useState } from 'react'
import { t } from '../locales.ts'
import css from '../board.module.css'
import type { SessionContext } from './use-interaction.ts'
import { contextWorthOf } from './interaction.ts'
import { Icon } from './ui.tsx'

/** One todo glyph: pending = dashed circle, in_progress = the shared spinner,
 *  completed = the shared check — the same three-state read as the harness's
 *  TodoPanel. */
function TodoGlyph({ status }: { status: 'pending' | 'in_progress' | 'completed' }) {
  if (status === 'completed') return <Icon name="check" className={css.sessionContextGlyphDone} />
  if (status === 'in_progress') return <span className={`${css.spinner} ${css.sessionContextGlyphActive}`} aria-hidden="true" />
  return <span className={css.sessionContextGlyphPending} aria-hidden="true" />
}

/** The deterministic context readout (see module doc): self-contained — the
 *  collapsed/expanded state and the outside-click dismissal live here. */
export function SessionContextBlock({ context }: { context: SessionContext }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (wrapRef.current !== null && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [open])

  const todos = context.todos ?? []
  const done = todos.filter(item => item.status === 'completed').length
  const active = todos.filter(item => item.status === 'in_progress').length
  const pending = todos.length - done - active
  const subagentCount = context.subagents?.length ?? 0
  // THE display rule: only UNFINISHED things are worth the block — a fully
  // completed todo list (or a non-active goal / finished subagents) hides the
  // whole readout (the "todo 全完成还显示" issue). Unknown statuses count as
  // active (a host reshape never hides live work).
  if (!contextWorthOf(context)) return null

  // The header summary — the harness's per-status progress counts (zero
  // segments omitted as noise), plus goal / subagent facts in the same line.
  const summary = [
    ...done > 0 ? [t('review.todosDone', { n: String(done) })] : [],
    ...active > 0 ? [t('review.todosActive', { n: String(active) })] : [],
    ...pending > 0 ? [t('review.todosPending', { n: String(pending) })] : [],
    context.goal !== undefined ? t('review.goalActiveWith') : undefined,
    subagentCount > 0 ? t('review.subagents', { n: String(subagentCount) }) : undefined,
  ].filter((part): part is string => part !== undefined).join(' · ')

  return (
    <div className={css.sessionContextWrap} ref={wrapRef}>
      <button
        type="button"
        className={css.sessionContextHead}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <Icon name="checklist" className={css.sessionContextLead} />
        <span className={css.sessionContextTitle}>{t('review.sessionContext')}</span>
        <span className={css.sessionContextSummary} title={summary}>{summary}</span>
        <Icon name="chevronDown" className={`${css.sessionContextChevron}${open ? ` ${css.sessionContextChevronOpen}` : ''}`} />
      </button>
      {open && (
        <div className={css.sessionContextPanel}>
          {todos.length > 0 && (
            <ul className={css.sessionContextTodos}>
              {todos.map((todo, index) => (
                <li key={`${todo.content}-${index}`} className={css.sessionContextTodo} data-status={todo.status}>
                  <span className={css.sessionContextTodoGlyph} aria-hidden="true">
                    <TodoGlyph status={todo.status} />
                  </span>
                  <span className={css.sessionContextText} data-done={todo.status === 'completed' ? '' : undefined}>
                    {todo.content}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {context.goal !== undefined && (
            <div className={css.sessionContextRow}>
              <span className={`${css.chip}${context.goal.active ? ` ${css.sessionContextGoalOn}` : ''}`}>
                {context.goal.active ? t('review.goalActive') : t('review.goal')}
              </span>
              <span className={css.sessionContextText}>{context.goal.title}</span>
            </div>
          )}
          {subagentCount > 0 && (
            <div className={css.sessionContextRow}>
              <span className={`${css.chip} ${css.sessionContextSubagent}`}>
                {t('review.subagents', { n: String(subagentCount) })}
              </span>
              <span className={css.sessionContextSubList}>
                {context.subagents!.map(sub => (
                  <span key={sub.title} className={css.sessionContextSubItem} title={sub.status ?? undefined}>
                    {sub.title}
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
