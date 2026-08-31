/**
 * The composer's image ledger — ONE mechanism for every surface that can
 * attach images (the comment composer, the refinement answer, the task's
 * execution prompt): state + intake from pick / drop / paste + a busy count
 * + the LAST rejection said out loud. A file that cannot become an image is
 * NEVER silently dropped (the old 「电脑端发不了图」 was silent rejection);
 * every rejection names its file and its reason.
 *
 * The host performs the durable admission when it takes the prompt — this
 * hook only produces the temporary-bytes wire shape (see attach.ts).
 */
import { useCallback, useRef, useState } from 'react'
import { t } from '../locales.ts'
import { encodeImageFile, type DraftImage, type ImageBudget, type ImageRejectReason } from './attach.ts'

/** One human line for one rejection reason (locale-owned). */
export function rejectMessage(reason: ImageRejectReason, name: string, max?: number): string {
  switch (reason) {
    case 'type': return t('attach.rejectType', { name })
    case 'size': return t('attach.rejectSize', { name })
    case 'decode': return t('attach.rejectDecode', { name })
    case 'count': return t('attach.rejectCount', { name, max: String(max ?? 0) })
  }
}

/** The state + affordances one composer needs for its images. */
export interface ComposerImages {
  images: readonly DraftImage[]
  /** Replace the ledger (composer clear after a send, chip removal). */
  setImages: (next: readonly DraftImage[]) => void
  /** Intake files (picker / drop / paste); rejections land in `error`. */
  addFiles: (files: FileList | File[]) => Promise<void>
  /** An image is being decoded/compressed right now. */
  busy: boolean
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
): ComposerImages {
  const [own, setOwn] = useState<readonly DraftImage[]>([])
  const images = controlled !== undefined ? controlled.images : own
  const [busyCount, setBusyCount] = useState(0)
  const [error, setError] = useState<string | undefined>(undefined)
  const [dragOver, setDragOver] = useState(false)
  // The async intake loop must see the LATEST ledger (two drops in flight
  // still respect the count cap), so the state mirrors into a ref.
  const imagesRef = useRef<readonly DraftImage[]>(images)
  imagesRef.current = images

  const setImages = useCallback((next: readonly DraftImage[]): void => {
    imagesRef.current = next
    if (controlled !== undefined) controlled.onChange(next)
    else setOwn(next)
    setError(undefined)
  }, [controlled])

  const addFiles = useCallback(async (files: FileList | File[]): Promise<void> => {
    const list = Array.from(files)
    if (list.length === 0) return
    setError(undefined)
    setBusyCount(count => count + 1)
    try {
      const next = [...imagesRef.current]
      for (const file of list) {
        if (next.length >= maxImages) {
          setError(rejectMessage('count', file.name, maxImages))
          break
        }
        const outcome = await encodeImageFile(file, budget)
        if (outcome.ok) next.push(outcome.image)
        else setError(rejectMessage(outcome.reason, file.name, maxImages))
      }
      imagesRef.current = next
      if (controlled !== undefined) controlled.onChange(next)
      else setOwn(next)
    } finally {
      setBusyCount(count => count - 1)
    }
  }, [budget, maxImages, controlled])

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

  return { images, setImages, addFiles, busy: busyCount > 0, error, dropProps }
}
