/**
 * Composer attachment strip: the image-drag/pick entrance of every composer
 * that attaches images (review page, session panel, refinement, task prompt).
 * It is PRESENTATION + the picker affordance; the ledger state, intake
 * (encode/compress) and the drop/paste wiring live in the shared
 * `useComposerImages` hook, which the composer spreads onto its container so
 * a drop anywhere on the composer (not just this strip) works. A plus button
 * opens the picker; encoded images show as removable chips; a busy row names
 * the in-flight compression and a rejection line names the failed file —
 * nothing is ever silently dropped. One grammar everywhere.
 */
import { useRef } from 'react'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Icon } from './ui.tsx'
import type { DraftImage } from './attach.ts'

export function AttachmentStrip({ images, onAdd, onRemove, busy, error }: {
  images: readonly DraftImage[]
  /** Intake picked files (the hook encodes + validates). */
  onAdd: (files: FileList | File[]) => void
  onRemove: (id: string) => void
  /** An image is decoding/compressing right now (phone photos take a beat). */
  busy?: boolean
  /** The last rejection, said out loud (never a silent drop). */
  error?: string
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  return (
    <div className={css.attachStrip}>
      <button
        type="button"
        className={css.attachAdd}
        aria-label={t('review.attachImage')}
        title={t('review.attachImage')}
        onClick={() => { fileRef.current?.click() }}
      >
        <Icon name="link" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={event => {
          if (event.currentTarget.files !== null) onAdd(event.currentTarget.files)
          event.currentTarget.value = ''
        }}
      />
      {images.map(image => (
        <span key={image.id} className={css.attachChip} title={image.name}>
          {/* The name is its own truncation item (min-width 0 + ellipsis) —
              the chip grammar: text truncates, the remove button never
              shrinks. A raw text child of an inline-flex chip would clip
              without an ellipsis (text-overflow needs a block box). */}
          <span className={css.attachChipName}>{image.name}</span>
          <button
            type="button"
            className={css.attachRemove}
            aria-label={image.name}
            onClick={() => { onRemove(image.id) }}
          >
            <Icon name="close" />
          </button>
        </span>
      ))}
      {busy === true && <span className={css.attachHint}>{t('review.attachBusy')}</span>}
      {error !== undefined && error !== '' && <span className={css.attachError}>{error}</span>}
    </div>
  )
}
