/**
 * Session context readout above the composer: the session's live to-do list,
 * active goal and subagents — shown when the session HAS any of those, hidden
 * completely when it has none (a deterministic all-or-nothing rule, no
 * partial flicker). One compact Disclosure, the shared collapse grammar.
 */
import css from '../board.module.css'
import { t } from '../locales.ts'
import { isOpenTodo } from './interaction.ts'
import type { SessionContext } from './use-interaction.ts'
import { Disclosure } from './ui.tsx'

/** The deterministic context readout (see module doc). */
export function SessionContextBlock({ context, open, onToggle }: {
  context: SessionContext
  open: boolean
  onToggle: () => void
}) {
  const todos = context.todos ?? []
  const openTodos = todos.filter(isOpenTodo)
  const subagentCount = context.subagents?.length ?? 0
  const hasAnything = openTodos.length > 0 || context.goal !== undefined || subagentCount > 0
  if (!hasAnything) return null

  // One-line live summary: opens + goal + subagent count.
  const summary = [
    openTodos.length > 0 ? t('review.todosOpen', { n: String(openTodos.length) }) : undefined,
    context.goal !== undefined ? (context.goal.active ? t('review.goalActiveWith') : context.goal.title) : undefined,
    subagentCount > 0 ? t('review.subagents', { n: String(subagentCount) }) : undefined,
  ].filter(part => part !== undefined).join(' · ')

  return (
    <Disclosure title={t('review.sessionContext')} summary={summary} open={open} onToggle={onToggle}>
      <div className={css.sessionContext}>
        {context.goal !== undefined && (
          <div className={css.sessionContextRow}>
            <span className={`${css.chip}${context.goal.active ? ` ${css.sessionContextGoalOn}` : ''}`}>
              {context.goal.active ? t('review.goalActive') : t('review.goal')}
            </span>
            <span className={css.sessionContextText}>{context.goal.title}</span>
          </div>
        )}
        {openTodos.length > 0 && (
          <ul className={css.sessionContextTodos}>
            {openTodos.map((todo, index) => (
              <li key={`${todo.content}-${index}`} className={css.sessionContextTodo} data-active={todo.status === 'in_progress' ? 'true' : undefined}>
                <span className={css.sessionContextTodoDot} aria-hidden="true" />
                <span className={css.sessionContextText}>{todo.content}</span>
              </li>
            ))}
          </ul>
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
    </Disclosure>
  )
}
