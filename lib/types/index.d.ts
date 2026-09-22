/**
 * Host loader entry for the task-board plugin.
 *
 * Everything the board does is browser work (DOM, localStorage, driving the
 * client runtime's session services over the wire), so the host half's job is
 * the HTTP routes the browser half reads: the shared board document and its
 * lease, the permission catalog, the native per-session state bridge, the
 * install source and the live page reports.
 *
 * Settings: the plugin's own profile entry carries the `Config` schema below,
 * and the plugin manager's detail page renders that schema as a form — one page
 * per entry, the board's switch living with the board. A field is editable only
 * when the schema marks it `volatile`, and a volatile field's runtime value is
 * a live reference rather than a plain value, so `pnpm verify` pins both facts
 * (this entry losing its schema or its volatile field loses the page silently).
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const inject: string[];
/**
 * Plugin config, validated by the same-named schemastery schema.
 *
 * The schema's EXPORT NAME is load-bearing: the plugin runtime reads it as
 * `module.Config`, so renaming the binding leaves the loader without a schema —
 * the plugin still loads and every route still registers, but the settings
 * surface treats the entry as unconfigurable and silently drops its page.
 *
 * The one field is `volatile`, which is what makes it editable AND immediate: a
 * write that touches only volatile fields updates the running instance in place
 * rather than reloading it. Its resolved value is a live reference to the
 * current value, not the value itself, so the browser half reads it through
 * `boardEnabledNow` instead of comparing it directly.
 */
export interface Config {
    /**
     * When true (default), the browser half puts the board on screen: the sidebar
     * entry and the board view itself. When false the board is hidden from this
     * deployment while the plugin stays loaded and its host routes stay served —
     * the switch is how the board is hidden without unloading anything, and the
     * plugin manager's own enable switch remains the way to unload it entirely.
     */
    boardEnabled?: boolean;
}
/** Plugin config schema (see {@link Config}). */
export declare const Config: z<Config>;
/** Declared entry point: the board's host routes, one effect per route. */
export declare function apply(ctx: Context): void;
