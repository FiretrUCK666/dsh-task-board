/**
 * Pending native question + session context over the composer: the review
 * page, session panel and refinement panel all render one surface while the
 * session's agent is awaiting a human decision (a plan for confirmation or an
 * ask_user_question), alongside the session's live to-do / goal / subagent
 * readout.
 *
 * The pending QUESTION comes from the controller's question face
 * (questionPendingOf / subscribeQuestions) — on 0.1.5 a read-only mirror of
 * the official pending snapshot (answering stays in the native session), on
 * older hosts the live tracker whose frame settles the suspended call. The
 * card appears/disappears with the real tool lifecycle either way. The to-do
 * list still rides the transcript tail
 * (last-write-wins `todo/write` snapshot); goal + subagents come from the
 * narrow session-state bridge when the host registered it.
 */
import { useEffect, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import type { WireQuestion } from '../../core/question-rpc.ts'
import { latestSessionTodos, type SessionTodo } from './interaction.ts'

/** The goal/subagent readout the host bridge carries (structural, degraded). */
export interface SessionGoalView {
  title: string
  active: boolean
}
export interface SessionSubagentView {
  title: string
  status?: string
}

/** The full session-context read (all blocks optional by availability). */
export interface SessionContext {
  /** The latest `todo/write` snapshot, if the session ever wrote one. */
  todos?: readonly SessionTodo[]
  /** The active native goal, if any. */
  goal?: SessionGoalView
  /** Child subagents of the session, if any. */
  subagents?: readonly SessionSubagentView[]
}

const STATE_URL = '/api/dsh-task-board/session-state'

/** One 3s poll: transcript → todos; bridge → goal + subagents. The board's
 *  tree stays mounted while hidden (the conversation view takes over), so the
 *  poll pauses whenever the board is not visible — `data-dsh-taskboard-active`
 *  on <html> is the ONE visibility marker (board-mount owns it) — and resumes
 *  with an immediate refresh the moment the board reappears. */
export function useSessionContext(controller: BoardController, sessionId: string | undefined): SessionContext {
  const [context, setContext] = useState<SessionContext>({})
  useEffect(() => {
    if (sessionId === undefined) {
      setContext({})
      return undefined
    }
    let alive = true
    let timer: number | undefined
    const visible = (): boolean => document.documentElement.hasAttribute('data-dsh-taskboard-active')

    const pollTranscript = (): void => {
      void controller.loadTranscript(sessionId).then(result => {
        if (!alive || result === undefined) return
        setContext(current => ({
          ...current,
          // The official `todos` projection FIRST (the harness's own TodoPanel
          // reads the same host-computed whole list), the transcript snapshot
          // parse as the legacy fallback when no deployment serves it.
          todos: result.projections?.todos ?? latestSessionTodos(result.events),
        }))
      })
    }

    const pollSessionState = (): void => {
      void fetch(`${STATE_URL}?sessionId=${encodeURIComponent(sessionId)}`)
        .then(response => (response.ok ? response.json() as Promise<{
          goal?: { title: string; active: boolean }
          subagents?: Array<{ title: string; status?: string }>
        }> : undefined))
        .then(view => {
          if (!alive) return
          setContext(current => ({
            ...current,
            goal: view?.goal,
            subagents: view?.subagents,
          }))
        })
        .catch(() => { /* bridge unavailable — silence */ })
    }

    const poll = (): void => { pollTranscript(); pollSessionState() }
    // Visibility flips (the board opening/closing) refresh the read at once.
    const observer = new MutationObserver(() => {
      if (visible()) poll()
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dsh-taskboard-active'] })

    if (visible()) poll()
    timer = window.setInterval(() => {
      if (visible()) { pollTranscript(); pollSessionState() }
    }, 3_000)
    return () => {
      alive = false
      if (timer !== undefined) window.clearInterval(timer)
      observer.disconnect()
    }
  }, [controller, sessionId])
  return context
}

/** The pending wire question for one session (mirror-driven, reactive). */
export function useWireQuestion(controller: BoardController, sessionId: string | undefined): WireQuestion | undefined {
  const [question, setQuestion] = useState<WireQuestion | undefined>(() => controller.questionPendingOf(sessionId))
  useEffect(() => {
    if (sessionId === undefined) {
      setQuestion(undefined)
      return undefined
    }
    setQuestion(controller.questionPendingOf(sessionId))
    return controller.subscribeQuestions(() => {
      setQuestion(controller.questionPendingOf(sessionId))
    })
  }, [controller, sessionId])
  return question
}
