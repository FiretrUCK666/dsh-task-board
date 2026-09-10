/**
 * Sidebar entry injection.
 *
 * dsh's sidebar shell exposes no slot an external plugin can register into
 * (`sidebar.workspaces` / `sidebar.settings` are single-occupant and already
 * taken), so — following the established DOM-extension approach — the
 * entry row is injected between the shell's New Session button and the
 * workspace browser. The injection self-heals: a MutationObserver watches the
 * body (structure + drawer/rail classes) and re-adopts + re-paints the row
 * whenever the sidebar mounts, is wiped by a React re-render, or toggles
 * (re-insertion happens in the same frame, before paint, so no flicker). The
 * row's geometry is pure CSS (a full-width sidebar row), never mirrored from
 * the native button — a JS pixel mirror reads 0 while the drawer is closed and
 * leaves the row invisible (the flaky "button won't show" this design avoids).
 *
 * The row is plain DOM (no React tree) so it can never disturb the shell's
 * reconciliation; the board view it toggles is a separate React root mounted
 * in the center column (see board-mount.ts).
 */
import type { BoardController } from '../core/controller.ts';
/**
 * Mount the sidebar entry row: wait for the shell sidebar to render, insert
 * the row once it appears, and self-heal on later React re-renders (the
 * sidebar root is re-queried on EVERY pass — never frozen — so a remounted
 * sidebar in a brand-new subtree is re-adopted instead of silently losing its
 * entry). There is deliberately NO floating corner fallback: the entry IS the
 * sidebar row; the board stays reachable through the shell's own sidebar on
 * every screen.
 * @param controller - the board controller the entry toggles.
 * @returns disposer removing the entry and its observer.
 */
export declare function mountSidebarEntry(controller: BoardController): () => void;
