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
 * edit in the UI, and the surfaces themselves are switched by the plugin page's
 * per-row switches — which write the profile, not a schema. A schema would only
 * add a second control for something that already has one.
 *
 * The plugin contributes FOUR rows, and the plugin page lists a switch per row:
 * this one (the package, which carries the browser half and the host truth),
 * plus `host-board`, `host-items` and `host-agent` — three host-side modules
 * whose whole job is to announce that their surface is on. The loader only
 * evaluates a row whose switch is on, so a switched-off surface is never
 * registered at all rather than present and inert, and no half has to check at
 * runtime — which is the only way a switch stays honest.
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * Only `webServer`. The model's whole surface (three tools, two slash commands,
 * one prompt section) moved to its own row — `host-agent.ts` — so the plugin
 * page can switch it off in one click, and switching it off means the loader
 * never evaluates it rather than a runtime check that could be forgotten.
 */
export declare const inject: string[];
/** Declared entry point: the board's host routes, one effect per route. */
export declare function apply(ctx: Context): void;
