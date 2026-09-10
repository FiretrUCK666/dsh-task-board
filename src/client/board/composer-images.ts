/**
 * The composer's attachment ledger — ONE mechanism for every surface that
 * can attach files (the comment composer, the refinement answer, the task's
 * execution prompt): images + staged files, intake from pick / drop / paste
 * + a busy count + the LAST rejection said out loud. A file that cannot be
 * staged is NEVER silently dropped (the old 「电脑端发不了图」 was silent
 * rejection); every rejection names its file and its reason.
 *
 * Two lanes, one ledger: IMAGES encode to temporary bytes in the browser
 * (see attach.ts); FILES upload their exact bytes first (same session) and
 * ride the prompt as opaque receipts. The host performs the durable
 * admission when it takes the prompt — this hook only produces the official
 * wire shapes.
 */
import { useCallback, useRef, useState } from 'react'
import { t } from '../locales.ts'
import { encodeImageFile, intakeDecision, MAX_COMMENT_FILES, type DraftFile, type DraftImage, type ImageBudget, type ImageRejectReason } from './attach.ts'

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

/**
 * Cap for persisted draft images (base64 chars, whole envelope): ONE
 * localStorage map holds EVERY draft, so an unsent 4MB phone photo must
 * never nuke the entire map silently (the store skips the whole write on
 * quota). Over the cap the images stay in memory only and the caller is
 * told (imagesDropped) so the surface can say so — text + file names
 * always persist.
 */
export const DRAFT_IMAGE_CHARS = 2_500_000

/** A composer draft that survives unmount: text + images + lost file names. */
export interface CommentDraftSnapshot {
  text: string
  images: DraftImage[]
  /** Names of staged files (bytes are unrecoverable after unmount — the
   *  surface names them so the user re-adds them, never silently drops). */
  fileNames: string[]
}

/**
 * Encode a composer draft for the string draft store (pure, tested). Empty
 * drafts encode to '' (the store treats it as a clear).
 */
export function encodeCommentDraft(
  text: string,
  images: readonly DraftImage[],
  files: readonly DraftFile[],
): { value: string; imagesDropped: boolean } {
  const kept: Array<{ name: string; data: string; mediaType: DraftImage['mediaType'] }> = []
  let chars = 0
  let imagesDropped = false
  for (const image of images) {
    if (chars + image.data.length > DRAFT_IMAGE_CHARS) {
      imagesDropped = true
      continue
    }
    chars += image.data.length
    kept.push({ name: image.name, data: image.data, mediaType: image.mediaType })
  }
  if (text === '' && kept.length === 0 && files.length === 0) return { value: '', imagesDropped }
  return {
    value: JSON.stringify({
      v: 1,
      text,
      images: kept,
      fileNames: files.map(file => file.name),
    }),
    imagesDropped,
  }
}

/**
 * Decode a stored comment draft (pure, tested): the v1 envelope, legacy raw
 * text (pre-attachment drafts), or corrupt → empty. Chip ids regenerate (a
 * restored chip is a new chip, never a key collision across sessions).
 */
export function decodeCommentDraft(raw: string | undefined): CommentDraftSnapshot {
  const empty: CommentDraftSnapshot = { text: '', images: [], fileNames: [] }
  if (raw === undefined || raw === '') return empty
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...empty, text: raw }
    const record = parsed as Record<string, unknown>
    if (record.v !== 1) return { ...empty, text: raw }
    const text = typeof record.text === 'string' ? record.text : ''
    const images: DraftImage[] = []
    if (Array.isArray(record.images)) {
      record.images.forEach((row, index) => {
        if (typeof row !== 'object' || row === null) return
        const candidate = row as Record<string, unknown>
        if (typeof candidate.data !== 'string' || candidate.data === '') return
        images.push({
          id: `restored-${index}-${candidate.data.slice(0, 8)}`,
          name: typeof candidate.name === 'string' ? candidate.name : '',
          data: candidate.data,
          mediaType: candidate.mediaType === 'image/png' || candidate.mediaType === 'image/jpeg'
            || candidate.mediaType === 'image/webp' || candidate.mediaType === 'image/gif'
            ? candidate.mediaType
            : 'image/jpeg',
        })
      })
    }
    const fileNames = Array.isArray(record.fileNames)
      ? record.fileNames.filter((name): name is string => typeof name === 'string' && name !== '')
      : []
    return { text, images, fileNames }
  } catch {
    return { ...empty, text: raw }
  }
}

/** Whether a picked batch contains any non-image (a re-add clears the lost-file notice). */
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

/** Stage one file's exact bytes on a session (the official pre-step). */
export type FileStager = (sessionId: string, file: File) => Promise<
  | { ok: true; receiptId: string }
  | { ok: false; error: string }
>

/** The state + affordances one composer needs for its attachments. */
export interface ComposerImages {
  images: readonly DraftImage[]
  files: readonly DraftFile[]
  /** Replace the image ledger (composer clear after a send, chip removal). */
  setImages: (next: readonly DraftImage[]) => void
  /** Replace the file ledger. */
  setFiles: (next: readonly DraftFile[]) => void
  /** Intake files (picker / drop / paste); rejections land in `error`. */
  addFiles: (files: FileList | File[]) => Promise<void>
  /** A file is being encoded/uploaded right now. */
  busy: boolean
  /**
   * WHAT is in flight right now (the busy line's truth — never the settled
   * ledger: a staging file is not in the ledger yet, and naming the busy
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

export function useComposerImages(
  budget: ImageBudget,
  maxImages: number,
  /** Controlled mode: the ledger lives OUTSIDE the hook (a task draft that
   *  must round-trip through save/restore); absent = the hook owns it. */
  controlled?: { images: readonly DraftImage[]; onChange: (next: readonly DraftImage[]) => void },
  /** File-lane options: the session to stage on + the stager. Absent = the
   *  file lane is closed (images only, legacy surfaces). */
  filesOpts?: { sessionId: string | undefined; stage: FileStager; maxFiles?: number },
): ComposerImages {
  const [own, setOwn] = useState<readonly DraftImage[]>([])
  const images = controlled !== undefined ? controlled.images : own
  const [ownFiles, setOwnFiles] = useState<readonly DraftFile[]>([])
  const filesLedger = ownFiles
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
  // The async intake loop must see the LATEST ledgers (two drops in flight
  // still respect the count caps), so the state mirrors into refs.
  const imagesRef = useRef<readonly DraftImage[]>(images)
  imagesRef.current = images
  const filesRef = useRef<readonly DraftFile[]>(filesLedger)
  filesRef.current = filesLedger

  const setImages = useCallback((next: readonly DraftImage[]): void => {
    imagesRef.current = next
    if (controlled !== undefined) controlled.onChange(next)
    else setOwn(next)
    setError(undefined)
  }, [controlled])

  const setFiles = useCallback((next: readonly DraftFile[]): void => {
    filesRef.current = next
    setOwnFiles(next)
    setError(undefined)
  }, [])

  const maxFiles = filesOpts?.maxFiles ?? MAX_COMMENT_FILES
  const addFiles = useCallback(async (picked: FileList | File[]): Promise<void> => {
    const list = Array.from(picked)
    if (list.length === 0) return
    setError(undefined)
    setBusyCount(count => count + 1)
    try {
      const next = [...imagesRef.current]
      const nextFiles = [...filesRef.current]
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
            if (outcome.ok) next.push(outcome.image)
            else setError(rejectMessage(outcome.reason, file.name, maxImages))
            continue
          }
          // File lane: stage the exact bytes first (same session), then carry
          // only the receipt. Closed lane / missing session / failed stage =
          // a spoken reason, never a silent drop.
          if (filesOpts === undefined || filesOpts.sessionId === undefined) {
            setError(t('attach.rejectNoSession', { name: file.name }))
            continue
          }
          if (nextFiles.length >= maxFiles) {
            setError(t('attach.rejectFileCount', { name: file.name, max: String(maxFiles) }))
            break
          }
          const staged = await filesOpts.stage(filesOpts.sessionId, file)
          if (!staged.ok) {
            setError(t('attach.rejectUpload', { name: file.name, error: staged.error }))
            continue
          }
          nextFiles.push({ id: `file-${Date.now()}-${nextFiles.length}`, receiptId: staged.receiptId, name: file.name, bytes: file.size })
        } finally {
          busyLanesRef.current[lane] -= 1
          syncBusyKind()
        }
      }
      imagesRef.current = next
      filesRef.current = nextFiles
      if (controlled !== undefined) controlled.onChange(next)
      else setOwn(next)
      setOwnFiles(nextFiles)
    } finally {
      setBusyCount(count => count - 1)
    }
  }, [budget, maxImages, controlled, filesOpts, maxFiles, syncBusyKind])

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

  return { images, files: filesLedger, setImages, setFiles, addFiles, busy: busyCount > 0, busyKind, error, dropProps }
}
