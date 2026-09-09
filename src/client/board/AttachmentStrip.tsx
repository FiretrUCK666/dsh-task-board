/**
 * Composer attachment strip: the file-drag/pick entrance of every composer
 * that attaches files (review page, session panel, refinement, task prompt).
 * It is PRESENTATION + the picker affordance; the ledger state, intake
 * (image encode/compress + file staging) and the drop/paste wiring live in
 * the shared `useComposerImages` hook, which the composer spreads onto its
 * container so a drop anywhere on the composer (not just this strip) works.
 * A plus button opens the picker (any file kind — images route to the image
 * lane, everything else to the staged-file lane); encoded images and staged
 * files show as removable chips; a busy row names the in-flight work and a
 * rejection line names the failed file — nothing is ever silently dropped.
 * One grammar everywhere.
 */
import { useRef } from 'react'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Icon } from './ui.tsx'
import type { DraftFile, DraftImage } from './attach.ts'
import type { IntakeBusyKind } from './composer-images.ts'

/**
 * The busy line for an in-flight intake, named by WHAT is in flight (never
 * the settled ledger — a staging file is not in the ledger yet). undefined
 * kind falls back to the image line (the only intake a file-lane-less
 * surface can start).
 */
export function attachBusyLabel(kind: IntakeBusyKind | undefined): string {
  if (kind === 'file') return t('review.attachFileBusy')
  if (kind === 'mixed') return t('review.attachWorking')
  return t('review.attachBusy')
}

/** Format a byte count compactly (B/KB/MB, one decimal under 100). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) {
    const v = bytes / 1024
    return `${v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)} KB`
  }
  const v = bytes / (1024 * 1024)
  return `${v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)} MB`
}

export function AttachmentStrip({ images, files, onAdd, onRemoveImage, onRemoveFile, busy, busyLabel, error }: {
  images: readonly DraftImage[]
  /** Staged files (empty when the surface closes the file lane). */
  files?: readonly DraftFile[]
  /** Intake picked files (the hook encodes + stages + validates). */
  onAdd: (files: FileList | File[]) => void
  onRemoveImage: (id: string) => void
  onRemoveFile?: (id: string) => void
  /** A file is encoding/uploading right now (phone photos/uploads take a beat). */
  busy?: boolean
  /** Busy line override (file uploads say uploading, not compressing). */
  busyLabel?: string
  /** The last rejection, said out loud (never a silent drop). */
  error?: string
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const staged = files ?? []
  return (
    <div className={css.attachStrip}>
      <button
        type="button"
        className={css.attachAdd}
        aria-label={t('review.attachFile')}
        title={t('review.attachFile')}
        onClick={() => { fileRef.current?.click() }}
      >
        <Icon name="link" />
      </button>
      <input
        ref={fileRef}
        type="file"
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
            onClick={() => { onRemoveImage(image.id) }}
          >
            <Icon name="close" />
          </button>
        </span>
      ))}
      {staged.map(file => (
        <span key={file.id} className={css.attachChip} title={`${file.name} · ${formatBytes(file.bytes)}`}>
          <span className={css.attachChipName}>{file.name}</span>
          <span className={css.attachChipMeta}>{formatBytes(file.bytes)}</span>
          {onRemoveFile !== undefined && (
            <button
              type="button"
              className={css.attachRemove}
              aria-label={file.name}
              onClick={() => { onRemoveFile(file.id) }}
            >
              <Icon name="close" />
            </button>
          )}
        </span>
      ))}
      {busy === true && <span className={css.attachHint}>{busyLabel ?? t('review.attachBusy')}</span>}
      {error !== undefined && error !== '' && <span className={css.attachError}>{error}</span>}
    </div>
  )
}
