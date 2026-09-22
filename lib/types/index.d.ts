/**
 * Host loader entry for the task-board plugin.
 *
 * Everything the board does is browser work (DOM, localStorage, driving the
 * client runtime's session services over the wire), so the host half's job is
 * the HTTP routes the browser half reads: the shared board document and its
 * lease, the permission catalog, the native per-session state bridge, the
 * install source and the live page reports.
 *
 * There is deliberately no `Config` schema here. Settings exist so a user can
 * change plugin behavior, and every behavior this plugin has is already the
 * user's own choice: tasks, schedules, cruise and rules are all board data they
 * edit in the UI, and turning the plugin itself on or off is the plugin
 * manager's switch — which writes the profile, not a schema. A schema would
 * only add a second control for something that already has one.
 *
 * That switch works by unloading this entry, and the loader only evaluates a
 * unit whose row is active: an off plugin loads nothing at all, including the
 * browser half, so no half needs to check whether it is enabled.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const inject: string[];
/** Declared entry point: the board's host routes, one effect per route. */
export declare function apply(ctx: Context): void;
