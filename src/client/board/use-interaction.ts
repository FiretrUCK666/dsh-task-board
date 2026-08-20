/**
 * Pending native interaction over the composer: the review page, session
 * panel and refinement panel all render one interaction card while the
 * session's agent is awaiting a human decision — a plan for confirmation or
 * an ask_user_question. Detection reuses the transcript tail's raw events
 * (the same load channel, watermark-gated: an idle session costs nothing),
 * so the card appears/disappears with the real tool lifecycle and needs no
 * extra host bridge.
 */
import { useEffect, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { detectPendingInteraction, type PendingInteraction } from './interaction.ts'

/**
 * Poll a session's raw history for an open ask_user_question call. Returns
 * the newest pending interaction, or undefined when none awaits.
 */
export function usePendingInteraction(controller: BoardController, sessionId: string | undefined): PendingInteraction | undefined {
  const [pending, setPending] = useState<PendingInteraction | undefined>(undefined)
  useEffect(() => {
    if (sessionId === undefined) {
      setPending(undefined)
      return undefined
    }
    let alive = true
    let timer: number | undefined
    const poll = (): void => {
      void controller.loadTranscript(sessionId).then(result => {
        if (!alive || result === undefined) return
        setPending(detectPendingInteraction(result.events))
      })
    }
    poll()
    timer = window.setInterval(poll, 3_000)
    return () => {
      alive = false
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [controller, sessionId])
  return pending
}
