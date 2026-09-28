/**
 * Contribute the task list as a MAIN-STAGE panel, in the same shape as the
 * board: one `main` seat keyed by the list's own id, one row in the shell's
 * panel list under that same id, and one way out shared with the board.
 *
 * WHY IT IS A MAIN-STAGE PANEL AND NOT A RIGHT-EDGE DRAWER. The list is a full
 * page of work — grouped columns, a filter row, a composer — and the shell's
 * main stage is the one surface that already handles every way the page can be
 * sized: the left sidebar wide or collapsed to an icon rail, a narrow viewport,
 * the shell's own panel toggle. A drawer had to re-derive all of that, and it
 * did: it sized itself from a CSS variable it never declared, so the whole
 * width declaration was dropped at computed-value time and the panel
 * collapsed to a strip.
 *
 * So: the same two official seats the board uses, the same id in both (the
 * shell resolves a panel-list row to its stage by that id), and the same exit
 * funnel. What is NOT shared is the identity — the board's id is
 * `dsh-task-board`, the list's is `dsh-task-board-items`, and the two rows sit
 * next to each other in the panel list by `order`.
 */
import type { ComponentType } from 'react'
import type { ChecklistReplica } from '../../core/host-sync.ts'
import type { BoardController } from '../../core/controller.ts'
import { t } from '../locales.ts'
import { readSurfaceManifest, surfaceEnabled } from '../surfaces.ts'
import { ItemListPanel } from './panel.tsx'
import { TaskListIcon } from './TaskListIcon.tsx'

/** The namespace this plugin already registers its strings under. */
const NS = 'dsh-task-board'

/**
 * The list's stage identity — ONE value for both official registrations, the
 * `main` key and the panel-list entry id, exactly as the board keeps its own
 * in one place so "they agree" is structural rather than a coincidence two call
 * sites have to remember.
 */
export const LIST_GROUP = { id: 'dsh-task-board-items' } as const

/** Sits directly after the board's row (which is 110). */
const LIST_ROW_ORDER = 120

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
 * ONE holder, and the module-level instance below is the only one: the earlier
 * code also had a second `new ItemListStage()` in the client entry, which bound
 * the live replica while this file's panel read the module singleton — so the
 * panel sat on "preparing" forever while every test stayed green. **A binding
 * side and a reading side that name the same thing are only the same thing if
 * they are the same object**, and that is a fact a type can check and a habit
 * cannot.
 *
 * The holder owns its own lifetime signal rather than borrowing a mount's: a
 * main-stage panel unmounts every time the reader looks at the conversation, so
 * a lifetime tied to its mount would tear down the replica subscription on
 * every panel switch. It aborts when the plugin does, and only then.
 */
export class ItemListStage {
  private itemReplica: ChecklistReplica | undefined
  private board: BoardController | undefined
  private readonly lifetime = new AbortController()

  /** Publish the two live faces; the signal already exists and is unchanged. */
  bind(replica: ChecklistReplica | undefined, controller: BoardController | undefined): void {
    this.itemReplica = replica
    this.board = controller
  }

  /** The plugin's own lifetime, for every timer and subscription inside. */
  signal(): AbortSignal {
    return this.lifetime.signal
  }

  replica(): ChecklistReplica | undefined {
    return this.itemReplica
  }

  controller(): BoardController | undefined {
    return this.board
  }

  /** Drop every face and end the lifetime; the panel then has nothing to read and says so. */
  unbind(): void {
    this.lifetime.abort()
    this.itemReplica = undefined
    this.board = undefined
  }
}

/** THE single stage, exported so the client entry binds THIS one. */
export const itemListStage = new ItemListStage()

/** Build the face the panel registration injects, read fresh on every render. */
function readFace(): ItemListFace {
  return { replica: itemListStage.replica(), controller: itemListStage.controller() }
}

/** The panel body, reading the holder fresh on every render. */
function ListPanel(props: Record<string, unknown>) {
  return (
    <ItemListPanel
      {...props}
      face={readFace()}
      signal={itemListStage.signal()}
    />
  )
}

/**
 * Contribute the list: its main-stage panel and the panel-list row that
 * selects it.
 *
 * Registration waits for the host's surface answer, because the answer decides
 * whether to register at all. A failed read registers anyway — see
 * `surfaces.ts` for why the failure direction is the whole design.
 *
 * @param ctx - the client context.
 * @param returnToConversation - the one way out, shared with the board's row.
 * @returns a disposer removing everything this contributed.
 */
export function registerItemList(ctx: Context, returnToConversation: () => void): () => void {
  const disposers: (() => void)[] = []
  const slots = ctx.get('slots') as SlotsFace | undefined
  if (slots === undefined) return () => undefined

  void readSurfaceManifest().then(manifest => {
    if (!surfaceEnabled('items', manifest)) return

    disposers.push(ctx.effect(() => slots.inject('main', () => {
      disposers.push(slots.register({
        name: 'main',
        key: LIST_GROUP.id,
        locale: NS,
        inject: () => readFace(),
      }, ListPanel as unknown as ComponentType<never>))
    }), 'dsh-task-board: task list main panel'))

    disposers.push(ctx.effect(() => slots.inject('sidebar.panellist', () => {
      disposers.push(slots.register({
        name: 'sidebar.panellist',
        // LIST-kind slot: id/order/label are the mandatory list shape.
        id: LIST_GROUP.id,
        order: LIST_ROW_ORDER,
        label: () => t('entry.itemLabel'),
        locale: NS,
      }, ((props: { size: number; active: boolean }) => (
        <TaskListIcon {...props} onExit={returnToConversation} />
      )) as unknown as ComponentType<never>))
    }), 'dsh-task-board: task list panel entry'))
  })

  return () => {
    for (let i = disposers.length - 1; i >= 0; i -= 1) disposers[i]?.()
    disposers.length = 0
  }
}
