/**
 * Wiring for the agent surface: the three tools, the two commands and the one
 * prompt section, registered from a single entry point.
 *
 * It exists as its own module so `src/index.ts` keeps its one-import-per-route
 * shape and so the whole surface can be torn down with ONE disposer. Three
 * separate effects would mean three ways for half a surface to exist.
 *
 * The board document the tools write is reached through the SAME service the
 * routes use — one unit, one live handle, one write lane — so an action the
 * model takes converges on every device by the same path a click does.
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * Register everything the model needs, and take it all off with the returned
 * disposer. A host that composes none of the three services registers nothing
 * rather than half of something.
 * @returns the disposer removing all registrations.
 */
export declare function registerTaskboardAgentSurface(ctx: Context): () => void;
