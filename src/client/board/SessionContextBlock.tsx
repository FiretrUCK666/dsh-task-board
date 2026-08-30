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
import { contextWorthOf, FINISHED_SUBAGENT_STATUS } from './interaction.ts'
import { Chip } from './Chip.tsx'
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
 *  collapsed/expanded state and the outside-click dismissal live here.
 *  `className` lets a surface place the block (the review pane docks its
 *  head at the conversation's top-right; the rail/refine surfaces keep the
 *  default in-flow slot). */
export function SessionContextBlock({ context, className }: { context: SessionContext; className?: string }) {
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
  // The host bridge already serves only LIVE subagents (finished ones are not
  // in flight); an unknown status still counts as live (never hides work).
  const liveSubagents = (context.subagents ?? []).filter(sub =>
    sub.status === undefined || !FINISHED_SUBAGENT_STATUS.has(sub.status))
  const subagentCount = liveSubagents.length
  const goalActive = context.goal?.active === true
  // THE display rule: only UNFINISHED things are worth the block — a fully
  // completed todo list (or no active goal / no live subagents) hides the
  // whole readout (the "todo 全完成还显示" issue). Unknown statuses count as
  // active (a host reshape never hides live work).
  if (!contextWorthOf({ ...context, subagents: liveSubagents })) return null

  // The header summary — the harness's per-status progress counts (zero
  // segments omitted as noise), plus goal / subagent facts in the same line.
  const summary = [
    ...done > 0 ? [t('review.todosDone', { n: String(done) })] : [],
    ...active > 0 ? [t('review.todosActive', { n: String(active) })] : [],
    ...pending > 0 ? [t('review.todosPending', { n: String(pending) })] : [],
    goalActive ? t('review.goalActiveWith') : undefined,
    subagentCount > 0 ? t('review.subagents', { n: String(subagentCount) }) : undefined,
  ].filter((part): part is string => part !== undefined).join(' · ')

  return (
    <div className={`${css.sessionContextWrap}${className !== undefined ? ` ${className}` : ''}`} ref={wrapRef}>
      <button
        type="button"
        className={css.sessionContextHead}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <Icon name="checklist" className={css.sessionContextLead} />
        <span className={css.sessionContextTitle}>{t('review.sessionContext')}</span>
        <span className={css.sessionContextSummary} title={summary}>{summary}</span>
        {/* THE shared chevron grammar (same law as every Disclosure): the
            icon is drawn pointing DOWN (expanded); collapsed it turns to
            point RIGHT — the fold always reads as a fold. */}
        <Icon name="chevronDown" className={css.sessionContextChevron} />
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
          {goalActive && (
            <div className={css.sessionContextRow}>
              {/* The badge rides the shared Chip two-slot grammar: the label
                  text lives in .chipBody (breaks only into an ellipsis, never
                  out of its box), and the chip shrinks never (flex: none) —
                  a long goal title can never push it over the paragraph. */}
              <Chip fill={false} className={css.sessionContextGoalOn}>
                {t('review.goalActive')}
              </Chip>
              <span className={css.sessionContextText}>{context.goal!.title}</span>
            </div>
          )}
          {subagentCount > 0 && (
            <div className={css.sessionContextBlock}>
              <Chip fill={false} className={css.sessionContextSubagent}>
                {t('review.subagents', { n: String(subagentCount) })}
              </Chip>
              {/* ONE row per subagent — same row grammar as the todo/goal
                  lines (marker + full text). Long titles never overlap or
                  ellipsize away: the whole crew is visible at a glance. */}
              <ul className={css.sessionContextSubList}>
                {liveSubagents.map(sub => (
                  <li key={sub.title} className={css.sessionContextSubItem}>
                    <span className={css.sessionContextSubDot} aria-hidden="true" />
                    <span className={css.sessionContextText} title={sub.status ?? undefined}>
                      {sub.title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
