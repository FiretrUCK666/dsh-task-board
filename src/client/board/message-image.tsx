/**
 * Message images: the durable ref is read back through the official attachment
 * RPC (cached + single-flighted by the wiring), then shown as a click-to-open
 * thumbnail. While loading it keeps its box (no layout jump); a failed/absent
 * read degrades to a quiet name chip, never a broken icon.
 *
 * ONE implementation for every surface that shows a message's pictures — the
 * turn renderer and the comment thread both read this. A second copy would
 * drift on exactly the three things it encodes: the placeholder box that keeps
 * the layout still, the failure that stays quiet, and the fetch that goes
 * through `controller.loadImage`.
 */
import { useEffect, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import type { TranscriptImage } from './review-transcript.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'

/** One image of one message. */
export function MessageImage({ controller, sessionId, image }: {
  controller: BoardController
  sessionId: string
  image: TranscriptImage
}) {
  const [src, setSrc] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    void controller.loadImage(sessionId, image.attachmentId).then(value => {
      if (!alive) return
      if (value === undefined) setFailed(true)
      else setSrc(`data:${value.mediaType};base64,${value.data}`)
    })
    return () => { alive = false }
  }, [controller, sessionId, image.attachmentId])
  if (failed) {
    return <span className={css.reviewImageMissing} title={image.name ?? ''}>{t('review.imageMissing')}</span>
  }
  if (src === undefined) {
    return <span className={css.reviewImageBox} aria-hidden="true" />
  }
  return (
    <a className={css.reviewImageBox} href={src} target="_blank" rel="noreferrer" title={image.name ?? ''}>
      <img className={css.reviewImage} src={src} alt={image.name ?? ''} loading="lazy" />
    </a>
  )
}

/** The image row of one message (nothing when it carries no pictures). */
export function MessageImages({ images, sessionId, controller }: {
  images: readonly TranscriptImage[] | undefined
  sessionId?: string
  controller?: BoardController
}) {
  if (images === undefined || images.length === 0 || controller === undefined || sessionId === undefined) return null
  return (
    <span className={css.reviewImageRow}>
      {images.map(image => (
        <MessageImage key={image.attachmentId} controller={controller} sessionId={sessionId} image={image} />
      ))}
    </span>
  )
}
