/**
 * Registration for the task list in DSH's own right Sidebar.
 *
 * WHY THE RIGHT SIDEBAR AND NOT THE BOARD PANEL. The board lives in the centre
 * stage, behind a click. This list exists for the moment you are NOT looking
 * at the board — you are mid-conversation with the model and an idea shows up.
 * The right sidebar is present in every session, so one button puts the list
 * where the thinking is already happening.
 *
 * WHY NONE OF THE TWO SERVICES IS IN `inject`. `sidebarRightTabs` and
 * `sidebarRight` are optional. A declared-but-missing service makes the whole
 * client half wait forever, and the board is mounted by that same half — so
 * waiting for the sidebar would take the board down with it. Both are read
 * with `ctx.get()` inside the effect, and when either is absent this module
 * registers nothing at all. Absence then means "the panel does not exist",
 * never "a half-rendered panel" and never "the board stopped working".
 *
 * The replica face is published through a mutable holder for the same reason
 * the board stage uses one: the slot is contributed at apply time, long before
 * the background settle has built the sync client.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ComponentType } from 'react'
import type { ChecklistReplica } from '../../core/host-sync.ts'
import type { BoardController } from '../../core/controller.ts'
import { t } from '../locales.ts'
import { ItemListPanel, type ItemListPanelProps } from './panel.tsx'
import css from '../board.module.css'

/** This implementation's identity; also the key the body registers under. */
const LIST_ID = '@firetruck666/dsh-task-board'
/** The page type this contribution opens. */
const LIST_KIND = 'task-list'
/** The namespace we already register with the shell. */
const NS = 'dsh-task-board'

/**
 * The face the panel reads. `replica` is `undefined` until the background
 * settle has built the sync client, which is why the panel renders a loading
 * state rather than assuming a live list.
 *
 * The board controller travels with it because "is the card this item hangs
 * off running" is ONE question with ONE answer in this plugin, and that answer
 * is `controller.liveStateOf`. The panel asking its own copy of that question
 * is exactly how the board and the list would start disagreeing.
 */
export interface ItemListFace {
  readonly replica: ChecklistReplica | undefined
  readonly controller: BoardController | undefined
}

/**
 * The holder behind the registration.
 *
 * Exactly one source of truth travels through it: the replica, the board, or
 * their absence. Nothing is cached, so a rebuilt sync client is picked up on
 * the next render without any rebinding.
 */
export class ItemListStage {
  private replica: ChecklistReplica | undefined
  private controller: BoardController | undefined

  /** Publish the live sync replica and the board it belongs to. */
  bind(replica: ChecklistReplica, controller: BoardController): void {
    this.replica = replica
    this.controller = controller
  }

  /** Stop publishing them (the plugin is being disposed). */
  unbind(): void {
    this.replica = undefined
    this.controller = undefined
  }

  /** Build the face the registration injects, read fresh on every render. */
  inject(): ItemListFace {
    return { replica: this.replica, controller: this.controller }
  }
}

/** The shape this module needs from the shell's slot framework, read by name. */
interface SlotsFace {
  inject(slot: string, run: () => void): () => void
  register(entry: Record<string, unknown>, component: ComponentType<never>): () => void
}

/** The tab-type registry, read by name so its absence is a value, not a wait. */
interface TabRegistryFace {
  register(definition: Record<string, unknown>): () => void
}

/** The right-sidebar controller, read by name for the same reason. */
interface SidebarControllerFace {
  openTab(kind: string, options?: Record<string, unknown>): void
}

/**
 * Contribute the task list: its page type, its body, and the button that opens
 * it. Every step is skipped when the sidebar is not composed, and that is the
 * whole degradation story.
 * @param ctx - the client context.
 * @param stage - the holder the background settle publishes the replica into.
 * @returns a disposer removing everything this contributed.
 */
export function registerItemList(ctx: Context, stage: ItemListStage): () => void {
  const disposers: (() => void)[] = []
  const slots = ctx.get('slots') as SlotsFace | undefined
  if (slots === undefined) return () => undefined

  // ① the page type. A fresh id is added BESIDE the shipped ones; reusing one
  // would replace it instead.
  const registry = ctx.get('sidebarRightTabs') as TabRegistryFace | undefined
  if (registry !== undefined) {
    disposers.push(ctx.effect(() => registry.register({
      id: LIST_ID,
      kind: LIST_KIND,
      // The panel is cheap to re-open and holds no unsaved state of its own
      // once an edit is committed, so there is nothing to keep alive.
      keepMounted: false,
      title: () => t('itemTab.title'),
      guide: [{
        id: 'list',
        order: 30,
        title: () => t('itemTab.guideTitle'),
        description: () => t('itemTab.guideDescription'),
      }],
    }), 'dsh-task-board: item list tab type'))
  }

  // ② the body. No `inject` on the registration: the slot's own declaration
  // already carries `hooks.tabInfo`, and a keyed registrant receives it.
  disposers.push(ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => {
    disposers.push(slots.register({ name: 'sidebar.right.pane.tab', key: LIST_ID, locale: NS }, ((props: ItemListPanelProps) => (
      <ItemListPanel {...props} face={stage.inject()} />
    )) as unknown as ComponentType<never>))
  }), 'dsh-task-board: item list body'))

  // ③ the entry button in the conversation header. `scope: 'session'` means it
  // only mounts where there IS a session, so no session means no dead button.
  const sidebar = ctx.get('sidebarRight') as SidebarControllerFace | undefined
  if (sidebar !== undefined) {
    disposers.push(ctx.effect(() => slots.inject('conversation.session.header.actions', () => {
      disposers.push(slots.register({
        name: 'conversation.session.header.actions',
        id: 'dsh-task-board.item-list',
        order: 40,
        locale: NS,
      }, (() => (
        <button
          type="button"
          className={css.itemListOpenButton}
          onClick={() => {
            try {
              sidebar.openTab(LIST_KIND)
            } catch (error) {
              // A page type the shell cannot open is a missing capability, not
              // a broken one; say so instead of throwing inside its handler.
              console.error('[dsh-task-board] could not open the task list', error)
            }
          }}
        >
          {t('itemTab.open')}
        </button>
      )) as unknown as ComponentType<never>))
    }), 'dsh-task-board: item list entry button'))
  }

  return () => {
    for (let i = disposers.length - 1; i >= 0; i -= 1) disposers[i]?.()
    disposers.length = 0
  }
}
