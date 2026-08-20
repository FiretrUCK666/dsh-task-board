/**
 * Pending native interaction + session context over the composer: the review
 * page, session panel and refinement panel all render one surface while the
 * session's agent is awaiting a human decision (a plan for confirmation or an
 * ask_user_question), alongside the session's live to-do / goal / subagent
 * readout. Detection reuses the transcript tail's raw events (the same load
 * channel, watermark-gated: an idle session costs nothing) — so the card
 * appears/disappears with the real tool lifecycle and needs no extra host
 * bridge. The to-do list rides the same event window (last-write-wins
 * `todo/write` snapshot); goal + subagents come from the narrow session-state
 * bridge when the host registered it.
 */
import { useEffect, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { detectPendingInteraction, latestSessionTodos, type PendingInteraction, type SessionTodo } from './interaction.ts'

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
  /** Open ask_user_question / plan-review awaiting the user, if any. */
  pendingInteraction?: PendingInteraction
  /** The latest `todo/write` snapshot, if the session ever wrote one. */
  todos?: readonly SessionTodo[]
  /** The active native goal, if any. */
  goal?: SessionGoalView
  /** Child subagents of the session, if any. */
  subagents?: readonly SessionSubagentView[]
}

const STATE_URL = '/api/dsh-task-board/session-state'

/** One 3s poll: transcript → interaction + todos; bridge → goal + subagents. */
export function useSessionContext(controller: BoardController, sessionId: string | undefined): SessionContext {
  const [context, setContext] = useState<SessionContext>({})
  useEffect(() => {
    if (sessionId === undefined) {
      setContext({})
      return undefined
    }
    let alive = true
    let timer: number | undefined

    const pollTranscript = (): void => {
      void controller.loadTranscript(sessionId).then(result => {
        if (!alive || result === undefined) return
        setContext(current => ({
          ...current,
          pendingInteraction: detectPendingInteraction(result.events),
          todos: latestSessionTodos(result.events),
        }))
      })
    }

    const pollSessionState = (): void => {
      void fetch(`${STATE_URL}?sessionId=${encodeURIComponent(sessionId)}`)
        .then(response => (response.ok ? response.json() as Promise<{
          plan?: { active: boolean; pending: boolean }
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

    pollTranscript()
    pollSessionState()
    timer = window.setInterval(() => {
      pollTranscript()
      pollSessionState()
    }, 3_000)
    return () => {
      alive = false
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [controller, sessionId])
  return context
}

/** The pending interaction alone (the subset surfaces that only need it). */
export function usePendingInteraction(controller: BoardController, sessionId: string | undefined): PendingInteraction | undefined {
  return useSessionContext(controller, sessionId).pendingInteraction
}
