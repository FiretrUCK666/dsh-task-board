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
import { ListOpenButton, publishListLauncher, type ListOpenerFace } from './launcher.tsx'

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
interface SidebarControllerFace extends ListOpenerFace {
  close(tabId: string): void
}

/**
 * What the slot hands a tab body: the host's own tab hook.
 *
 * The shape is declared here, by hand and by name, rather than imported from
 * the shell's package — the same discipline as every other face in this file (a
 * cross-package VALUE import is banned, and a type-only one would drag the
 * package into the build for no runtime gain).
 *
 * Typing it as `() => unknown` was worse than useless: it reads as "there is
 * nothing here to reach for", so nobody ever reaches, and the panel quietly
 * loses the host's own lifecycle. These members are the ones that matter:
 *
 * - `signal` — the host's lifetime for this tab. It aborts when the record
 *   goes away or the plugin unloads, and NOT on hide or a session switch, so
 *   it is the one handle every timer and subscription in this panel hangs its
 *   disposer on. A resource outliving its owner is the bug it exists to catch.
 * - `active` — whether this tab is the one being looked at. A panel that keeps
 *   working behind another tab spends the reader's battery on a picture nobody
 *   can see.
 * - `tab.visible` — the same question for a docked body, which stays mounted
 *   while the column is collapsed or another pane has focus.
 *
 * WHERE IT WAS CHECKED, because nothing will shout if DSH renames it. Against
 * the installed `@deepseek-ai/dsh-client-ui-sidebar-right@0.1.7-rc.2`, in
 * `lib/types/client/contract/slots.d.ts` (where the `useTabInfo` slot-hook is
 * declared) and `lib/types/client/tab-info.d.ts` (the `TabHookContext`
 * fields). Re-read those two after every host upgrade. This is the same
 * situation as `PLATFORM_MODULES` and it has NO gate: a rename upstream would
 * leave this declaration quietly wrong rather than loudly broken, and the
 * symptom would be a panel that keeps ticking after its owner is gone.
 */
export interface ItemTabHookContext {
  readonly tabId: string
  /** Which of the two registrations this is: the body, or the chip's title. */
  readonly title: boolean
  readonly active: boolean
  readonly fullscreen: boolean
  readonly signal: AbortSignal
  /** What this tab may do to itself, always inside its own session. */
  readonly actions: {
    openTab(kind: string, options?: Record<string, unknown>): void
    close(): void
  }
  readonly tab: {
    readonly id: string
    readonly kind: string
    readonly title: string
    /** Only the foreground session's tab is visible. */
    readonly visible: boolean
  }
  readonly sidebar: { readonly expanded: boolean; readonly fullscreen: boolean }
  readonly panel: { readonly id: string }
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
      // Resident, not "open and leave". The list is the thing being kept an
      // eye on, so switching away from its tab and back must not hand back an
      // empty column. The price is a live subscription and a clock — and both
      // are already paid for correctly: the subscription hangs on the host's
      // own `signal`, and a tab nobody is looking at does not run its clock.
      keepMounted: true,
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

  // ③ the entry button in the conversation header, AND the launcher the board's
  // own header button uses. Both go through `ListOpenButton`, so there is one
  // implementation of "can this be opened right now" and not two that drift.
  //
  // The launcher is published HERE and withdrawn on dispose, which is the whole
  // lifetime it needs. `scope: 'session'` on the header seat means it only
  // mounts where there IS a session; the board's button does not live on that
  // seat at all, and says nothing when the seat itself is gone.
  const sidebar = ctx.get('sidebarRight') as SidebarControllerFace | undefined
  disposers.push(publishListLauncher(sidebar))
  if (sidebar !== undefined) {
    disposers.push(ctx.effect(() => slots.inject('conversation.session.header.actions', () => {
      disposers.push(slots.register({
        name: 'conversation.session.header.actions',
        id: 'dsh-task-board.item-list',
        order: 40,
        locale: NS,
      }, (() => (
        <ListOpenButton />
      )) as unknown as ComponentType<never>))
    }), 'dsh-task-board: item list entry button'))
  }

  return () => {
    for (let i = disposers.length - 1; i >= 0; i -= 1) disposers[i]?.()
    disposers.length = 0
  }
}
