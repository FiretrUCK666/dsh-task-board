/**
 * Contribute the task list as a drawer of our own, plus the pill that opens it.
 *
 * The list is NOT a tab in the host's right sidebar. A sidebar tab is
 * remembered per session, and "open once, stay put, still be there in the next
 * session" is not a thing a per-session layout can promise. The drawer is ours,
 * so it does not care which session is on screen — see drawer.tsx for the
 * surface, and for the one coexistence gap that is named rather than papered
 * over.
 */
import type { ComponentType } from 'react'
import type { ChecklistReplica } from '../../core/host-sync.ts'
import type { BoardController } from '../../core/controller.ts'
import { TaskDrawer, restoreDrawer, resetDrawer } from './drawer.tsx'
import { ListOpenPill, bindSidebar } from './launcher.tsx'

const NS = 'dsh-task-board'

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

/** What the panel needs to read, and nothing more. */
export interface ItemListFace {
  readonly replica: ChecklistReplica | undefined
  readonly controller: BoardController | undefined
}

/**
 * The holder the background settle publishes into, and the panel reads from.
 *
 * One holder, not two: the drawer's own mount IS the lifetime, so the signal it
 * hands the panel aborts when the drawer goes away — which is what makes every
 * timer and subscription inside provably short-lived (lifecycle discipline: a
 * resource outliving its owner is the bug the signal exists to catch).
 */
export class ItemListStage {
  private itemReplica: ChecklistReplica | undefined
  private board: BoardController | undefined
  private lifetime = new AbortController()

  /** Publish the two live faces; the signal already exists and is unchanged. */
  bind(replica: ChecklistReplica | undefined, controller: BoardController | undefined): void {
    this.itemReplica = replica
    this.board = controller
  }

  /** Mirror an external lifetime onto the one the panel holds. */
  bindSignal(signal: AbortSignal): void {
    signal.addEventListener('abort', () => { this.lifetime.abort() }, { once: true })
  }

  signal(): AbortSignal {
    return this.lifetime.signal
  }

  replica(): ChecklistReplica | undefined {
    return this.itemReplica
  }

  controller(): BoardController | undefined {
    return this.board
  }

  /** Drop every face; the panel then has nothing to read and says so. */
  unbind(): void {
    this.lifetime.abort()
    this.itemReplica = undefined
    this.board = undefined
  }
}

/** The single stage every outlet reads through. */
export const stage = new ItemListStage()

/**
 * Contribute the drawer and the pill.
 * @param ctx - the client context.
 * @param itemStage - the holder the background settle publishes into; every
 *   outlet reads the panel's faces through it, so there is one holder and not
 *   one per surface.
 * @returns a disposer removing everything this contributed.
 */
export function registerItemList(ctx: Context, itemStage: ItemListStage = stage): () => void {
  void itemStage
  const disposers: (() => void)[] = []
  const slots = ctx.get('slots') as SlotsFace | undefined
  if (slots === undefined) return () => undefined

  // ① the drawer, on the shell's own frame-wide overlay. That seat exists
  // precisely for "a surface of your own, above every column, click-through
  // until an entry opts back in" — so the resident edge never blocks the app
  // underneath, and the open panel floats above the sidebar column without a
  // hand-rolled portal into the shell's DOM.
  disposers.push(ctx.effect(() => slots.inject('shell.overlay', () => {
    disposers.push(slots.register({
      name: 'shell.overlay',
      id: 'dsh-task-board.item-drawer',
      order: 20,
      locale: NS,
    }, (() => <TaskDrawer />) as unknown as ComponentType<never>))
  }), 'dsh-task-board: task list drawer'))

  // ② the pill in the conversation header: the second outlet, sharing the very
  // same state as the edge, and taking the edge's rule about the sidebar.
  disposers.push(ctx.effect(() => slots.inject('conversation.session.header.actions', () => {
    disposers.push(slots.register({
      name: 'conversation.session.header.actions',
      id: 'dsh-task-board.item-list',
      order: 40,
      locale: NS,
    }, (() => <ListOpenPill />) as unknown as ComponentType<never>))
  }), 'dsh-task-board: task list pill'))

  // ③ the sidebar face, read by name. Its absence costs the collapse rule and
  // nothing else — the drawer is ours and does not depend on the sidebar.
  const sidebar = ctx.get('sidebarRight')
  bindSidebar(sidebar as never)
  disposers.push(() => { bindSidebar(undefined) })

  // ④ what the reader last had open, restored before anything renders it.
  restoreDrawer()
  disposers.push(resetDrawer)

  return () => {
    for (let i = disposers.length - 1; i >= 0; i -= 1) disposers[i]?.()
    disposers.length = 0
  }
}
