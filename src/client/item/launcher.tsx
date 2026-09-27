/**
 * The one rule about the official right sidebar, and the pill that opens the list.
 *
 * There is exactly ONE place that knows "the official sidebar is in the way",
 * and it is `yieldToSidebar()`. Every outlet goes through it, so no two of them
 * can drift, and the rule is written once instead of being re-decided per
 * button.
 */
import type { ComponentProps } from 'react'
import type { Pill as ShellPill } from '@deepseek-ai/dsh-client-ui-primitives'
import { t } from '../locales.ts'
import { openDrawer } from './drawer.tsx'
import css from '../board.module.css'

/*
 * The pill's CONTRACT is the host's own type, and only the contract. The value
 * is deliberately never imported: that package declares no runtime
 * dependencies at all — everything it needs sits in its devDependencies — so
 * it is built for the shell's own use, not for an outside plugin to pull
 * values from. Re-creating its look from its class names is the other thing we
 * may not do: guessing the shell's DOM or classes is the one fragile surface
 * no document backs up.
 *
 * So the shape is checked by `tsc` and the appearance comes from the shell's
 * own tokens — which is what a skin actually rewrites. That is why
 * `.itemListPill` reads `--dsw-*` and never `--dsh-tb-*`: the board's aliases
 * are how WE read the shell's tokens, and this chip is not the board.
 */

/**
 * The narrow face of the official sidebar this rule needs.
 *
 * `mounted` is the seat's liveness. `isExpanded` is NOT a subscription and the
 * package emits no event, so it is a one-time read BY DESIGN — which is why
 * `yieldToSidebar` is called at the moment the reader asks for us, and not
 * watched continuously: the read is only ever worth taking while the answer
 * can still act on it.
 */
export interface SidebarYieldFace {
  readonly mounted: { getSnapshot(): string | undefined; subscribe(fn: () => void): () => void }
  isExpanded(): boolean
  toggleExpanded(): void
}

let sidebar: SidebarYieldFace | undefined

/**
 * Take the right edge, if the official sidebar is holding it.
 *
 * This is the half of "never coexist" that is actually available. Collapsing
 * it is guaranteed and asserted. Noticing when THEY open is not available at
 * all, so that half is a named gap rather than a rule — the reader resolves it
 * by collapsing us, and the README says so in as many words.
 * @returns true when the official column was collapsed for us.
 */
export function yieldToSidebar(): boolean {
  if (sidebar === undefined) return false
  if (sidebar.mounted.getSnapshot() === undefined) return false
  if (!sidebar.isExpanded()) return false
  sidebar.toggleExpanded()
  return true
}

/** Publish the sidebar face while this plugin is composed. */
export function bindSidebar(face: SidebarYieldFace | undefined): void {
  sidebar = face
}

/**
 * The list's glyph, in the SHELL's own pill.
 *
 * A hand-rolled `<button>` is why this used to look out of place and why no
 * third-party skin could reach it. `Pill` is on the platform module list, so it
 * takes the shell's own tokens and a skin follows it for free.
 *
 * The glyph is our own `icon.svg` redrawn inline rather than imported: an SVG
 * import would be a bundler contract this plugin has no precedent for, and
 * three bars in `currentColor` carry the same silhouette while following the
 * pill's colour instead of freezing the brand hex into the UI.
 * @returns the pill.
 */
export function ListOpenPill() {
  // The props are the host's own type, so satisfying them IS the check: a
  // prop the shell renames or drops fails here, not in production.
  const props: ComponentProps<typeof ShellPill> = {
    className: css.itemListPill,
    'aria-label': t('itemTab.open'),
    onClick: () => { yieldToSidebar(); openDrawer() },
  }
  return (
    <span {...props}>
      <svg width="16" height="16" viewBox="0 0 36 36" fill="none" aria-hidden="true" className={css.itemListPillIcon}>
        <rect x="5" y="6" width="7.5" height="24" rx="2.4" fill="currentColor" />
        <rect x="14.25" y="6" width="7.5" height="16" rx="2.4" fill="currentColor" opacity="0.65" />
        <rect x="23.5" y="6" width="7.5" height="21" rx="2.4" fill="currentColor" opacity="0.4" />
      </svg>
    </span>
  )
}
