/**
 * Composer attachment strip: the file-drag/pick entrance of every surface that
 * attaches files (the task prompt, the comment composers, a session rule's
 * instruction, a checklist row's body).
 *
 * It is PRESENTATION + the picker affordance; the ledger state, the intake
 * (image compression, admission) and the drop/paste wiring live in the shared
 * `useComposerAttachments` hook, which the composer spreads onto its container
 * so a drop anywhere on the composer (not just this strip) works. A plus button
 * opens the picker (any file kind — images are compressed first, everything else
 * goes up byte-for-byte); every entry shows as a removable chip with its name
 * and, for files, its size; a busy row names the in-flight work and a rejection
 * line names the failed file — nothing is ever silently dropped. One grammar
 * everywhere, and the chips are the same whether the row is a card, a comment or
 * a checklist line.
 */
import { useRef } from 'react'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Icon } from './ui.tsx'
import type { DraftAttachment } from './composer-attachments.ts'
import type { IntakeBusyKind } from './composer-attachments.ts'

/**
 * The busy line for an in-flight intake, named by WHAT is in flight (never
 * the settled ledger — a file being admitted is not in the ledger yet).
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

export function AttachmentStrip({ attachments, onAdd, onRemove, busy, busyLabel, error, hint }: {
  /** The ledger, in the order the reader added it. */
  attachments: readonly DraftAttachment[]
  /** Intake picked files (the hook compresses + admits + validates). */
  onAdd: (files: FileList | File[]) => void
  onRemove: (id: string) => void
  /** A file is being compressed/admitted right now. */
  busy?: boolean
  /** Busy line override (uploads say uploading, not compressing). */
  busyLabel?: string
  /** The last rejection, said out loud (never a silent drop). */
  error?: string
  /** One quiet line under the chips (what this surface's attachments mean). */
  hint?: string
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  return (
    <div className={css.attachStrip}>
      {/* 芯片、取件按钮与那个藏起来的框**同一条横滚行**：它们是同一件事（这一条带了哪几个
          文件），而句子（正在传 / 收不了 / 这条附件是什么）在下面各自占一行——把句子塞进
          这一行，窄屏上它会缩成一个字一行的竖条（见 `.attachRow` 的注释）。 */}
      <div className={css.attachRow}>
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
        {attachments.map(attachment => (
          <span key={attachment.id} className={css.attachChip} title={`${attachment.name} · ${formatBytes(attachment.bytes)}`}>
            {/* The name is its own truncation item (min-width 0 + ellipsis) —
                the chip grammar: text truncates, the remove button never
                shrinks. A raw text child of an inline-flex chip would clip
                without an ellipsis (text-overflow needs a block box). */}
            <span className={css.attachChipName}>{attachment.name}</span>
            <span className={css.attachChipMeta}>{formatBytes(attachment.bytes)}</span>
            <button
              type="button"
              className={css.attachRemove}
              aria-label={attachment.name}
              onClick={() => { onRemove(attachment.id) }}
            >
              <Icon name="close" />
            </button>
          </span>
        ))}
      </div>
      {busy === true && <span className={css.attachHint}>{busyLabel ?? t('review.attachBusy')}</span>}
      {error !== undefined && error !== '' && <span className={css.attachError}>{error}</span>}
      {hint !== undefined && hint !== '' && <span className={css.attachHint}>{hint}</span>}
    </div>
  )
}
