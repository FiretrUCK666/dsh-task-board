/**
 * Shared badge: every pill and badge on the board renders through this one
 * component, so all badges share one size, weight and semantic color system
 * and differ only in density. `fill` renders the pill look (neutral fill +
 * padding) for roomy surfaces like the detail; `fill={false}` renders plain
 * semibold text for dense surfaces like cards, where the text must align
 * flush with the card's left edge.
 *
 * Two-slot no-breakout contract: a badge is a lead glyph + one text run, and
 * each slot is handled structurally so neither can ever break the other.
 *   - `children` is ALWAYS text: it rides on a `.chipBody` span that truncates
 *     with an ellipsis when the badge has less room than its text (a flex
 *     container cannot ellipsize its own text items). Combined with the
 *     chip's shrinkable flex sizing, whatever text a badge carries can never
 *     escape its surface.
 *   - `icon` is a lead glyph (activity spinner, icon, dot): it renders in a
 *     `.chipLead` span that stays a real flex item of the chip, so its box
 *     geometry and the chip's gap apply and it is NEVER wrapped by — or
 *     ellipsized away inside — the text body.
 * The `title` attribute keeps the full text reachable on hover; `label`
 *  carries the same explanation to assistive tech (touch has no hover — the
 *  longer reason must not live in `title` alone).
 */
import type { ReactNode } from 'react';
/** Semantic chip color; neutral is the default. */
export type ChipKind = 'neutral' | 'success' | 'error' | 'warn' | 'muted';
/** One badge. */
export declare function Chip({ kind, fill, title, label, className, icon, children }: {
    kind?: ChipKind;
    /** Pill look with neutral fill; false = plain semibold text. */
    fill?: boolean;
    title?: string;
    /** Accessible name; defaults to `title` so a titled chip can never regress
     *  to hover-only again — pass an explicit label only to say something the
     *  title does not. */
    label?: string;
    className?: string;
    /** Lead glyph (activity spinner, icon) with its own box geometry — kept a
     *  real flex item, outside the ellipsizing text body. */
    icon?: ReactNode;
    children: ReactNode;
}): import("react").JSX.Element;
