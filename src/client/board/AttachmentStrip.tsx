/**
 * Composer attachment strip: the image-drag/pick entrance of the review page
 * and session-panel composers. A plus button (or dropping files on the strip)
 * encodes browser images into the native base64 wire form and holds them as
 * removable chips until the comment sends. One grammar everywhere — the strip
 * is a single shared component, so both composers behave identically.
 */
import { useRef, useState } from 'react'
import css from '../board.module.css'
import { encodeImageFile, IMAGE_MEDIA_TYPES, type DraftImage } from './attach.ts'
import { Icon } from './ui.tsx'

export function AttachmentStrip({ images, onChange }: {
  images: readonly DraftImage[]
  onChange: (images: DraftImage[]) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const addFiles = async (files: FileList | File[]): Promise<void> => {
    // Appends to the current selection: picking a second batch must never
    // drop the first (the strip is the composer's one image ledger).
    const added: DraftImage[] = []
    for (const file of Array.from(files)) {
      if (!IMAGE_MEDIA_TYPES.includes(file.type as (typeof IMAGE_MEDIA_TYPES)[number])) continue
      const draft = await encodeImageFile(file)
      if (draft !== undefined) added.push(draft)
    }
    if (added.length > 0) onChange([...images, ...added])
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragOver(false)
    void addFiles(event.dataTransfer.files)
  }

  return (
    <div
      className={`${css.attachStrip}${dragOver ? ` ${css.attachStripOver}` : ''}`}
      onDragOver={event => { event.preventDefault(); setDragOver(true) }}
      onDragLeave={() => { setDragOver(false) }}
      onDrop={onDrop}
    >
      <button
        type="button"
        className={css.attachAdd}
        onClick={() => { fileRef.current?.click() }}
      >
        <Icon name="link" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_MEDIA_TYPES.join(',')}
        multiple
        hidden
        onChange={event => {
          if (event.currentTarget.files !== null) void addFiles(event.currentTarget.files)
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
            onClick={() => { onChange(images.filter(candidate => candidate.id !== image.id)) }}
          >
            <Icon name="close" />
          </button>
        </span>
      ))}
      {images.length === 0 && dragOver && <span className={css.attachHint}>拖放图片到此处</span>}
    </div>
  )
}
