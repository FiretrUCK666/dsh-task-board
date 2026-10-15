/**
 * Contribute the design-system gallery: its main-stage panel and the
 * panel-list row that selects it.
 *
 * THE FAILURE DIRECTION IS THE OPPOSITE OF THE OTHER TWO PANELS. A product
 * panel must register even when the host cannot be asked — a broken switch has
 * to leave the plugin exactly as it was before anyone thought about switches.
 * The gallery is a developer instrument, so an unreadable manifest must leave
 * it ABSENT: putting a design catalogue in front of a user whose host is merely
 * unreachable is the one outcome worse than not showing it. That is what the
 * `whenUnknown = false` argument says, and it is the whole reason
 * `surfaceEnabled` grew a third parameter instead of one default serving both.
 *
 * The host announces `design` only when `DSH_TASK_BOARD_DESIGN_PREVIEW=1`, so in
 * a normal install this module's `then` returns before registering anything and
 * the shell never grows a row.
 */
import type { ComponentType } from 'react'
import { t } from '../locales.ts'
import { readSurfaceManifest, surfaceEnabled } from '../surfaces.ts'
import { DesignGallery } from './panel.tsx'
import { GalleryIcon } from './GalleryIcon.tsx'

/** The namespace this plugin already registers its strings under. */
const NS = 'dsh-task-board'

/**
 * The gallery's stage identity — ONE value for both official registrations, the
 * `main` key and the panel-list entry id, exactly as the board and the list
 * keep their own in one place so "they agree" is structural.
 */
export const GALLERY_GROUP = { id: 'dsh-task-board-design' } as const

/** Sits directly after the list's row (which is 120). */
const GALLERY_ROW_ORDER = 130

/** The cordis client context, narrowed to the two calls this contribution makes. */
interface Context {
  get(name: string): unknown
  effect(run: () => void | (() => void), label?: string): () => void
}

/** The narrow face of the slot surface, read by name so absence is a value. */
interface SlotsFace {
  inject(slot: string, run: () => void): () => void
  register(entry: Record<string, unknown>, component: ComponentType<never>): () => void
}

/**
 * Contribute the gallery, when the host says its surface is on.
 * @param ctx - the client context.
 * @param returnToConversation - the one way out, shared with the other panels.
 * @returns a disposer removing everything this contributed.
 */
export function registerDesignGallery(ctx: Context, returnToConversation: () => void): () => void {
  const disposers: (() => void)[] = []
  const slots = ctx.get('slots') as SlotsFace | undefined
  if (slots === undefined) return () => undefined

  void readSurfaceManifest().then(manifest => {
    if (!surfaceEnabled('design', manifest, false)) return

    disposers.push(ctx.effect(() => slots.inject('main', () => {
      disposers.push(slots.register({
        name: 'main',
        key: GALLERY_GROUP.id,
        locale: NS,
      }, DesignGallery as unknown as ComponentType<never>))
    }), 'dsh-task-board: design gallery main panel'))

    disposers.push(ctx.effect(() => slots.inject('sidebar.panellist', () => {
      disposers.push(slots.register({
        name: 'sidebar.panellist',
        // LIST-kind slot: id/order/label are the mandatory list shape.
        id: GALLERY_GROUP.id,
        order: GALLERY_ROW_ORDER,
        label: () => t('entry.designLabel'),
        locale: NS,
      }, ((props: { size: number; active: boolean }) => (
        <GalleryIcon {...props} onExit={returnToConversation} />
      )) as unknown as ComponentType<never>))
    }), 'dsh-task-board: design gallery entry'))
  })

  return () => {
    for (let i = disposers.length - 1; i >= 0; i -= 1) disposers[i]?.()
    disposers.length = 0
  }
}
