/**
 * The composer's attachment ledger — ONE mechanism for every surface that can
 * attach files: the task's execution prompt, the comment composers (排队 and
 * 插话), a session rule's instruction, and a checklist row's body.
 *
 * ONE LANE TO STORE. A picked image is compressed in the browser and then
 * admitted — like every other file — into the official attachment store through
 * the plugin's host route; the ledger holds the resulting refs. Nothing here
 * builds a wire part, picks a transport, or keeps a second copy of the bytes.
 *
 * ONE LANE TO SEND comes later: the wiring materializes the official prompt
 * parts from the same refs (image bytes inline, files through the host's own
 * upload face) when a message actually goes out. That is why a ledger entry
 * survives a reload, a device switch, a scheduled rule firing next week and a
 * promotion from the checklist into a card.
 *
 * A file that cannot be admitted is NEVER silently dropped (the old
 * 「电脑端发不了图」 was silent rejection): every rejection names its file and its
 * reason, and whatever did land stays in the ledger.
 */
import { useCallback, useRef, useState } from 'react'
import type { AttachmentRef } from '../../core/attachment.ts'
import { t } from '../locales.ts'
import {
  encodeImageFile, intakeDecision, MAX_COMMENT_FILES, MAX_UPLOAD_BYTES, readFileBase64,
  type EncodedImage, type ImageBudget, type ImageRejectReason,
} from './attach.ts'

/** One admitted attachment in a composer ledger: a durable ref plus the local
 *  key the strip needs for its chips. */
export interface DraftAttachment extends AttachmentRef {
  id: string
}

/** Admit one picked file's bytes into the store; the ONE upload path. */
export type AttachmentAdmitter = (
  input: { name: string; data: string; mediaType?: string },
) => Promise<{ ok: true; ref: AttachmentRef } | { ok: false; error: string }>

/**
 * 一枚芯片的本地键：**内容寻址的 id 加它在表里的位置**。
 *
 * 位置要进来，因为同一个文件可以被挂两次（两份芯片、两个删除键），而删除键只能指一个。
 * 位置让这个键**在两次渲染之间是同一个字符串**——React 靠它认得出「还是那几枚芯片」；
 * 而它**不进文档**（`refsOf` 把它丢掉），所以它变了也换不掉任何一条记录。
 */
export function chipKeyOf(ref: AttachmentRef, at: number): string {
  return `${ref.attachmentId}:${at}`
}

/** 文档里那一份读成芯片表（`refsOf` 是反方向，两个方向只有这一对）。 */
export function chipsOf(refs: readonly AttachmentRef[]): DraftAttachment[] {
  return refs.map((ref, at) => ({ ...ref, id: chipKeyOf(ref, at) }))
}

/** 芯片表写回文档的那一份：本地键不是记录的一部分，出这一层就丢掉。 */
export function refsOf(chips: readonly DraftAttachment[]): AttachmentRef[] {
  return chips.map(chip => ({
    attachmentId: chip.attachmentId,
    name: chip.name,
    bytes: chip.bytes,
    ...(chip.mediaType !== undefined ? { mediaType: chip.mediaType } : {}),
    ...(chip.width !== undefined ? { width: chip.width } : {}),
    ...(chip.height !== undefined ? { height: chip.height } : {}),
  }))
}

/** Image-lane or file-lane for one picked file (pure routing, no I/O). */
function intakeDecisionOf(file: File): 'image' | 'file' {
  const decision = intakeDecision(file.type, file.size, { maxEdge: 0, maxBytes: Number.POSITIVE_INFINITY, quality: 1 })
  return decision.kind === 'file' ? 'file' : 'image'
}

/** The in-flight intake kind (what the busy line must name). */
export type IntakeBusyKind = 'image' | 'file' | 'mixed'

/** Combine per-lane in-flight counts into one label kind (pure, tested). */
export function busyKindOf(images: number, files: number): IntakeBusyKind | undefined {
  if (images > 0 && files > 0) return 'mixed'
  if (files > 0) return 'file'
  if (images > 0) return 'image'
  return undefined
}

/** A composer draft that survives unmount: text + the refs it carries. */
export interface CommentDraftSnapshot {
  text: string
  attachments: DraftAttachment[]
  /**
   * v1 leftovers: images the OLD draft grammar kept as base64 bytes. They are
   * re-admitted on restore (one round trip), so an unsent picture is never lost
   * by an upgrade — it just arrives as a ref a moment later.
   */
  legacyImages: EncodedImage[]
}

/**
 * Encode a composer draft for the string draft store (pure, tested). Empty
 * drafts encode to '' (the store treats it as a clear).
 *
 * The payload is now tiny by construction: refs are id + name + size, so the
 * old byte cap that used to drop pictures from a full draft map is gone — every
 * attachment a reader picked is still there when they come back.
 */
export function encodeCommentDraft(
  text: string,
  attachments: readonly DraftAttachment[],
): string {
  if (text === '' && attachments.length === 0) return ''
  return JSON.stringify({
    v: 2,
    text,
    attachments: attachments.map(attachment => ({
      attachmentId: attachment.attachmentId,
      name: attachment.name,
      bytes: attachment.bytes,
      ...attachment.mediaType !== undefined ? { mediaType: attachment.mediaType } : {},
    })),
  })
}

/**
 * Decode a stored comment draft (pure, tested): the v2 ref envelope, the v1
 * envelope this revision replaced (text + inline image bytes, re-admitted on
 * restore), legacy raw text (pre-attachment drafts), or corrupt → empty.
 */
export function decodeCommentDraft(raw: string | undefined): CommentDraftSnapshot {
  const empty: CommentDraftSnapshot = { text: '', attachments: [], legacyImages: [] }
  if (raw === undefined || raw === '') return empty
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...empty, text: raw }
    const record = parsed as Record<string, unknown>
    const text = typeof record.text === 'string' ? record.text : ''
    if (record.v === 2) {
      const attachments: DraftAttachment[] = []
      if (Array.isArray(record.attachments)) {
        record.attachments.forEach((row, index) => {
          if (typeof row !== 'object' || row === null) return
          const candidate = row as Record<string, unknown>
          if (typeof candidate.attachmentId !== 'string' || candidate.attachmentId === '') return
          if (typeof candidate.name !== 'string') return
          if (typeof candidate.bytes !== 'number' || !Number.isFinite(candidate.bytes)) return
          attachments.push({
            id: `restored-${index}-${candidate.attachmentId.slice(0, 8)}`,
            attachmentId: candidate.attachmentId,
            name: candidate.name,
            bytes: candidate.bytes,
            ...typeof candidate.mediaType === 'string' ? { mediaType: candidate.mediaType } : {},
          })
        })
      }
      return { text, attachments, legacyImages: [] }
    }
    if (record.v !== 1) return { ...empty, text: raw }
    const legacyImages: EncodedImage[] = []
    if (Array.isArray(record.images)) {
      for (const row of record.images) {
        if (typeof row !== 'object' || row === null) continue
        const candidate = row as Record<string, unknown>
        if (typeof candidate.data !== 'string' || candidate.data === '') continue
        const mediaType = candidate.mediaType
        legacyImages.push({
          name: typeof candidate.name === 'string' ? candidate.name : '',
          data: candidate.data,
          mediaType: mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/webp' || mediaType === 'image/gif'
            ? mediaType
            : 'image/jpeg',
        })
      }
    }
    return { text, attachments: [], legacyImages }
  } catch {
    return { ...empty, text: raw }
  }
}

/** Whether a picked batch contains any non-image (a re-add clears stale notices). */
export function pickedHasFiles(files: FileList | File[]): boolean {
  return Array.from(files).some(file => !file.type.startsWith('image/'))
}

/** One human line for one rejection reason (locale-owned). */
export function rejectMessage(reason: ImageRejectReason, name: string, max?: number): string {
  switch (reason) {
    case 'type': return t('attach.rejectType', { name })
    case 'size': return t('attach.rejectSize', { name })
    case 'decode': return t('attach.rejectDecode', { name })
    case 'count': return t('attach.rejectCount', { name, max: String(max ?? 0) })
  }
}

/** What one composer needs from its attachment ledger. */
export interface ComposerAttachments {
  attachments: readonly DraftAttachment[]
  /** Replace the ledger (composer clear after a send, chip removal, restore). */
  setAttachments: (next: readonly DraftAttachment[]) => void
  /** Intake files (picker / drop / paste); rejections land in `error`. */
  addFiles: (files: FileList | File[]) => Promise<void>
  /** Admit already-encoded images (the v1 draft restore path). */
  addEncoded: (images: readonly EncodedImage[]) => Promise<void>
  /** A file is being encoded/admitted right now. */
  busy: boolean
  /**
   * WHAT is in flight right now (the busy line's truth — never the settled
   * ledger: a file being admitted is not in the ledger yet, and naming the busy
   * line from the ledger is exactly the "传文件却显示图片压缩中" lie).
   * undefined while idle.
   */
  busyKind: IntakeBusyKind | undefined
  /** The last rejection reason (one quiet line, replaced by the next try). */
  error: string | undefined
  /** Spread on the composer CONTAINER so drop-anywhere and paste work. */
  dropProps: {
    'data-dsh-tb-dndover': '' | undefined
    onDragOver: (event: React.DragEvent) => void
    onDragLeave: (event: React.DragEvent) => void
    onDrop: (event: React.DragEvent) => void
    onPaste: (event: React.ClipboardEvent) => void
  }
}

/** The one impure seam: admit bytes, hand back the durable ref. */
export interface ComposerAttachmentOptions {
  readonly budget: ImageBudget
  readonly maxImages: number
  readonly maxFiles?: number
  /** The host admission (absent = the surface is read-only about attachments). */
  readonly admit?: AttachmentAdmitter
  /** Controlled mode: the ledger lives OUTSIDE the hook (a draft that must
   *  round-trip through save/restore); absent = the hook owns it. */
  readonly controlled?: {
    attachments: readonly DraftAttachment[]
    onChange: (next: readonly DraftAttachment[]) => void
  }
}

let chipSequence = 0

/** Mint one chip key (local identity only; the ref is the durable identity). */
function chipIdOf(ref: AttachmentRef): string {
  chipSequence += 1
  return `att-${Date.now()}-${chipSequence}-${ref.attachmentId.slice(0, 6)}`
}

export function useComposerAttachments(options: ComposerAttachmentOptions): ComposerAttachments {
  const { budget, maxImages, admit, controlled } = options
  const maxFiles = options.maxFiles ?? MAX_COMMENT_FILES
  const [own, setOwn] = useState<readonly DraftAttachment[]>([])
  const attachments = controlled !== undefined ? controlled.attachments : own
  const [busyCount, setBusyCount] = useState(0)
  const [error, setError] = useState<string | undefined>(undefined)
  const [dragOver, setDragOver] = useState(false)
  // In-flight intake by lane (the busy line's truth — see busyKind). Counts,
  // not booleans: concurrent addFiles calls overlap, and a second drop must
  // not clear the first drop's kind while it is still working.
  const busyLanesRef = useRef({ image: 0, file: 0 })
  const [busyKind, setBusyKind] = useState<IntakeBusyKind | undefined>(undefined)
  const syncBusyKind = useCallback((): void => {
    const lanes = busyLanesRef.current
    setBusyKind(busyKindOf(lanes.image, lanes.file))
  }, [])
  // The async intake loop must see the LATEST ledger (two drops in flight still
  // respect the count caps), so the state mirrors into a ref.
  const ledgerRef = useRef<readonly DraftAttachment[]>(attachments)
  ledgerRef.current = attachments

  /**
   * Land a new ledger.
   *
   * **它不碰 `error`，而这不是省略——清了它就等于把一次拒绝咽下去。** 每一条收件
   * 循环都以 `commit` 收尾，而拒绝是在循环里报的（`setError`）：`commit` 顺手清一次，
   * 读者就只会看到那一行闪一下然后消失，屏上只剩「文件没进来」。「永不明着丢」这句
   * 承诺就是被这一行清掉的。所以 `error` 只有两个出口：**下一次收件的开头**
   * （`addFiles` / `addEncoded` 各清一次）与读者自己重试。
   */
  const commit = useCallback((next: readonly DraftAttachment[]): void => {
    ledgerRef.current = next
    if (controlled !== undefined) controlled.onChange(next)
    else setOwn(next)
  }, [controlled])

  const setAttachments = useCallback((next: readonly DraftAttachment[]): void => {
    commit([...next])
  }, [commit])

  /** Admit one image already encoded (shared by the picker and the v1 restore). */
  const addEncoded = useCallback(async (images: readonly EncodedImage[]): Promise<void> => {
    if (images.length === 0) return
    setError(undefined)
    setBusyCount(count => count + 1)
    const next = [...ledgerRef.current]
    try {
      for (const image of images) {
        if (next.length >= maxImages) {
          setError(rejectMessage('count', image.name, maxImages))
          break
        }
        busyLanesRef.current.image += 1
        syncBusyKind()
        try {
          const ref = await admitRefOf(admit, image, setError)
          if (ref === undefined) continue
          next.push({ ...ref, id: chipIdOf(ref) })
        } finally {
          busyLanesRef.current.image -= 1
          syncBusyKind()
        }
      }
      commit(next)
    } finally {
      setBusyCount(count => count - 1)
    }
  }, [admit, commit, maxImages, syncBusyKind])

  const addFiles = useCallback(async (picked: FileList | File[]): Promise<void> => {
    const list = Array.from(picked)
    if (list.length === 0) return
    setError(undefined)
    setBusyCount(count => count + 1)
    try {
      const next = [...ledgerRef.current]
      for (const file of list) {
        const lane = intakeDecisionOf(file)
        busyLanesRef.current[lane] += 1
        syncBusyKind()
        try {
          if (lane === 'image') {
            if (next.length >= maxImages) {
              setError(rejectMessage('count', file.name, maxImages))
              break
            }
            const outcome = await encodeImageFile(file, budget)
            if (!outcome.ok) {
              setError(rejectMessage(outcome.reason, file.name, maxImages))
              continue
            }
            const ref = await admitRefOf(admit, outcome.image, setError)
            if (ref === undefined) continue
            next.push({ ...ref, id: chipIdOf(ref) })
            continue
          }
          // File lane: the exact bytes go up, the ref comes back. No session is
          // involved, so a checklist row can attach a file exactly like a card.
          const fileCount = next.filter(entry => entry.mediaType === undefined).length
          if (fileCount >= maxFiles) {
            setError(t('attach.rejectFileCount', { name: file.name, max: String(maxFiles) }))
            break
          }
          if (file.size > MAX_UPLOAD_BYTES) {
            setError(rejectMessage('size', file.name))
            continue
          }
          const data = await readFileBase64(file)
          if (data === '') {
            setError(rejectMessage('decode', file.name))
            continue
          }
          const ref = await admitRefOf(admit, { name: file.name, data }, setError)
          if (ref === undefined) continue
          next.push({ ...ref, id: chipIdOf(ref) })
        } finally {
          busyLanesRef.current[lane] -= 1
          syncBusyKind()
        }
      }
      commit(next)
    } finally {
      setBusyCount(count => count - 1)
    }
  }, [admit, budget, commit, maxFiles, maxImages, syncBusyKind])

  const dropProps = {
    'data-dsh-tb-dndover': dragOver ? ('' as const) : undefined,
    onDragOver: (event: React.DragEvent): void => {
      // Only FILES light the ring (a card/session drag crossing the composer
      // must never look like an image drop).
      if (Array.from(event.dataTransfer.types).includes('Files')) {
        event.preventDefault()
        setDragOver(true)
      }
    },
    onDragLeave: (event: React.DragEvent): void => {
      // Leaving a CHILD bubbles here too; only a true exit clears the ring.
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false)
    },
    onDrop: (event: React.DragEvent): void => {
      setDragOver(false)
      if (event.dataTransfer.files.length > 0) {
        event.preventDefault()
        void addFiles(event.dataTransfer.files)
      }
    },
    onPaste: (event: React.ClipboardEvent): void => {
      // Desktop habit: paste a screenshot straight into the input. Text
      // pastes carry no files and fall through to the textarea untouched.
      const files = Array.from(event.clipboardData.files)
      if (files.length > 0) {
        event.preventDefault()
        void addFiles(files)
      }
    },
  }

  return { attachments, setAttachments, addFiles, addEncoded, busy: busyCount > 0, busyKind, error, dropProps }
}

/**
 * Admit one encoded payload and hand back the ref, saying WHY when it fails.
 * A missing store and a refused upload are different sentences — the reader can
 * act on the second one and can only wait out the first.
 */
async function admitRefOf(
  admit: AttachmentAdmitter | undefined,
  input: { name: string; data: string; mediaType?: string },
  report: (message: string) => void = () => {},
): Promise<AttachmentRef | undefined> {
  if (admit === undefined) {
    report(t('attach.rejectNoStore', { name: input.name }))
    return undefined
  }
  const admitted = await admit(input)
  if (!admitted.ok) {
    report(t('attach.rejectUpload', { name: input.name, error: admitted.error }))
    return undefined
  }
  return admitted.ref
}
