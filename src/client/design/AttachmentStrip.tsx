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
 *
 * IT BELONGS TO THE DESIGN SYSTEM because five hosts in two panels render it —
 * the chip grammar has one home, and a second copy would drift the first time a
 * chip changed shape. Nothing here knows what a ledger IS: the chips it draws
 * are the shape it declares itself (id, name, bytes), so the design system
 * depends on no page, and the busy line — which names the LEDGER's state — stays
 * with the ledger (see `attachBusyLabel` in `board/composer-attachments.ts`).
 */
import { useRef } from 'react'
import { t } from '../locales.ts'
import css from './components.module.css'
import { Icon } from './ui.tsx'

/**
 * One chip as this component draws it: what to show, and which entry to hand
 * back when it is removed. Deliberately a SHAPE rather than the ledger's own
 * record — `DraftAttachment` satisfies it, and any caller with the same three
 * fields needs nothing more.
 */
export interface AttachmentChip {
  /** The ledger's local key for this entry (removal names it). */
  readonly id: string
  /** The file's name, as chosen. */
  readonly name: string
  /** Its size in bytes. */
  readonly bytes: number
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

export function AttachmentStrip({ attachments, onAdd, onRemove, busy, busyLabel, error }: {
  /** The chips, in the order the reader added them. */
  attachments: readonly AttachmentChip[]
  /** Intake picked files (the hook compresses + admits + validates). */
  onAdd: (files: FileList | File[]) => void
  onRemove: (id: string) => void
  /** A file is being compressed/admitted right now. */
  busy?: boolean
  /** Busy line override (uploads say uploading, not compressing). */
  busyLabel?: string
  /** The last rejection, said out loud (never a silent drop). */
  error?: string
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  return (
    <div className={css.attachStrip}>
      {/* 芯片、取件按钮与那个藏起来的框**同一条横滚行**：它们是同一件事（这一条带了哪几个
          文件）。句子（正在传 / 收不了）跟着这一行走，但各自带着**宽度地板**
          （`.attachHint` 的 `min-inline-size`）——装得下就同排，装不下就整句换到
          下一行；被压成一个字一行的竖条是这条街上前一版的样子（见 `.attachRow` 的注释）。
          **这一条没有「这条附件是什么」那句话了**：它是规则，不是操作这一格的人每一眼都要
          读的东西（读者要求把添加附件的文案全部删掉）。状态与拒绝仍然说得出话。 */}
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
            <span className={css.truncate}>{attachment.name}</span>
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
      {/* 兜底那句是**中性**的（「正在处理附件…」），不是图片那句：选件或拖入的
          第一帧还分不出车道，用图片文案盖在一个文档上就是在说另一件事——
          它会为每个文件闪一下，于是每个文件看起来都像图片。 */}
      {busy === true && <span className={css.attachHint}>{busyLabel ?? t('review.attachWorking')}</span>}
      {error !== undefined && error !== '' && <span className={css.errorLine}>{error}</span>}
    </div>
  )
}
