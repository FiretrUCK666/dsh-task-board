/**
 * Pending native question + session context over the composer: the review
 * page and session panel both render one surface while the
 * session's agent is awaiting a human decision (a plan for confirmation or an
 * ask_user_question), alongside the session's live to-do / goal / subagent
 * readout.
 *
 * The pending QUESTION comes from the controller's question face
 * (questionPendingOf / subscribeQuestions) — on 0.1.5 the official pending
 * snapshot, whose carrier the card answers through in place (identical to the
 * native question card); on older hosts the live tracker whose frame settles
 * the suspended call. The card appears/disappears with the real tool
 * lifecycle either way. The to-do list still rides the transcript tail
 * (last-write-wins `todo/write` snapshot); goal + subagents come from the
 * narrow session-state bridge when the host registered it.
 */
import { useEffect, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import type { PendingInteractionKind } from '../../core/controller.ts'
import { awaitingOf } from '../../core/question-mirror.ts'
import type { WireQuestion } from '../../core/question-rpc.ts'
import { routeUrl } from '../route-base.ts'
import { latestSessionTodos, type SessionTodo } from './interaction.ts'

/** The goal/subagent readout (structural, degraded). The official `goal`
 *  projection wins when served; the session-state bridge is the fallback. */
export interface SessionGoalView {
  title: string
  active: boolean
  /** Durable goal identity (projection only — the bridge has no id). */
  id?: string
  /** Durable lifecycle phase when read from the official `goal` projection. */
  phase?: 'active' | 'paused' | 'blocked' | 'complete'
  /** Admitted goal rounds (projection only). */
  roundsStarted?: number
  /** Blocker explanation (exactly while phase is `blocked`). */
  blockedReason?: { code: string; message: string }
  /** Process-local continuation eligibility (official activation hook); the
   *  transcript poll never writes it — it arrives via `remote.goals.get`
   *  once plus `goal/activation-changed`, and survives re-polls while the
   *  goal id is unchanged. */
  activation?: 'armed' | 'disarmed'
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

const STATE_URL = routeUrl('/api/dsh-task-board/session-state')

/** One 3s poll: transcript → todos; bridge → goal + subagents. The board is a
 *  centre-stage PANEL now, so the shell unmounts this whole tree whenever
 *  another panel (or the Conversation) is selected — there is no "mounted but
 *  hidden" state to detect, and the poll starts fresh on the next selection.
 *  The remaining case is a mounted board in a BACKGROUND TAB, which is what
 *  `document.visibilityState` answers. */
export function useSessionContext(controller: BoardController, sessionId: string | undefined): SessionContext {
  const [context, setContext] = useState<SessionContext>({})
  useEffect(() => {
    if (sessionId === undefined) {
      setContext({})
      return undefined
    }
    let alive = true
    let timer: number | undefined
    const visible = (): boolean => document.visibilityState === 'visible'

    const pollTranscript = (): void => {
      void controller.loadTranscript(sessionId).then(result => {
        if (!alive || result === undefined) return
        // The official `goal` projection FIRST (same source as the native
        // goal surface): `null`/missing defers to the bridge below; a
        // `complete` phase never surfaces (official renders nothing for it).
        const projected = result.projections?.goal
        const goal = projected === undefined
          ? undefined
          : projected === null || projected.phase === 'complete'
            ? null
            : {
              title: projected.objective,
              active: true,
              id: projected.id,
              phase: projected.phase,
              roundsStarted: projected.roundsStarted,
              ...projected.blockedReason !== undefined ? { blockedReason: projected.blockedReason } : {},
            }
        setContext(current => ({
          ...current,
          // The official `todos` projection FIRST (the harness's own TodoPanel
          // reads the same host-computed whole list), the transcript snapshot
          // parse as the legacy fallback when no deployment serves it.
          todos: result.projections?.todos ?? latestSessionTodos(result.events),
          // A projected goal (or its null) wins over the bridge; undefined
          // leaves whatever the bridge reported. Activation survives
          // re-polls while the goal id is unchanged (it arrives on its own
          // channel below); a new id drops the stale value.
          ...goal !== undefined
            ? {
              goal: goal === null
                ? undefined
                : {
                  ...goal,
                  ...goal.id !== undefined && current.goal?.id === goal.id && current.goal.activation !== undefined
                    ? { activation: current.goal.activation }
                    : {},
                },
            }
            : {},
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
            // The bridge only fills the goal when the projection said nothing
            // (undefined) — a projected null (cleared) stays hidden even if
            // the bridge still echoes a stale row.
            ...current.goal === undefined ? { goal: view?.goal } : {},
            subagents: view?.subagents,
          }))
        })
        .catch(() => { /* bridge unavailable — silence */ })
    }

    const poll = (): void => { pollTranscript(); pollSessionState() }
    // Coming back to the tab refreshes the read at once instead of waiting out
    // the interval. (There is no "board hidden behind the conversation" case to
    // observe any more: panel switching unmounts this tree entirely, so the
    // effect's own mount IS the board appearing.)
    const onVisibility = (): void => { if (visible()) poll() }
    document.addEventListener('visibilitychange', onVisibility)

    if (visible()) poll()
    timer = window.setInterval(() => {
      if (visible()) { pollTranscript(); pollSessionState() }
    }, 3_000)
    return () => {
      alive = false
      if (timer !== undefined) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [controller, sessionId])
  // Process-local activation: `remote.goals.get` once (its durable goal is
  // ignored — the transcript projection above owns the display; only the
  // activation is taken), then live on `goal/activation-changed`. Absent
  // verbs = no activation (the strip shows pause for an active goal).
  useEffect(() => {
    if (sessionId === undefined) return undefined
    const verbs = controller.goalVerbs(sessionId)
    if (verbs === undefined) return undefined
    let alive = true
    verbs.get().then(raw => {
      if (!alive) return
      const view = raw as { activation?: unknown } | null
      if (view === null || typeof view !== 'object') return
      if (view.activation !== 'armed' && view.activation !== 'disarmed') return
      const activation = view.activation
      setContext(current => current.goal === undefined
        ? current
        : { ...current, goal: { ...current.goal, activation } })
    }).catch(() => { /* get failed — activation stays unknown */ })
    return controller.subscribeGoalActivation(sessionId, change => {
      setContext(current => {
        if (current.goal === undefined) return current
        if (change === undefined) {
          if (current.goal.activation === undefined) return current
          const { activation: _dropped, ...rest } = current.goal
          return { ...current, goal: rest }
        }
        return { ...current, goal: { ...current.goal, activation: change.activation } }
      })
    })
  }, [controller, sessionId])
  return context
}

/** The pending wire question for one session (mirror-driven, reactive).
 *  Module-private: display surfaces read {@link useAwaitingCard}. */
function useWireQuestion(controller: BoardController, sessionId: string | undefined): WireQuestion | undefined {
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

/**
 * What the comment interface shows for a session's wait: parsed content, or —
 * when the session list proves a plan/question wait but no content parsed —
 * an honest shell (kind + navigate) instead of blank nothing. The shell is
 * the backstop against carrier-shape drift on any present or future host:
 * a proven wait can never again reach the UI as silence. Every surface with
 * a comment composer reads this one hook (review page, session panel)
 * — never useWireQuestion directly for display.
 */
export function useAwaitingCard(
  controller: BoardController,
  sessionId: string | undefined,
): { question: WireQuestion | undefined; shell: 'plan-review' | 'question' | undefined } {
  const question = useWireQuestion(controller, sessionId)
  const [waiting, setWaiting] = useState<PendingInteractionKind | undefined>(() =>
    controller.pendingInteractionOf(sessionId))
  useEffect(() => {
    if (sessionId === undefined) {
      setWaiting(undefined)
      return undefined
    }
    setWaiting(controller.pendingInteractionOf(sessionId))
    return controller.subscribe(() => {
      setWaiting(controller.pendingInteractionOf(sessionId))
    })
  }, [controller, sessionId])
  const card = awaitingOf(question, waiting)
  if (card?.type === 'shell') return { question: undefined, shell: card.waitingKind }
  return { question, shell: undefined }
}
