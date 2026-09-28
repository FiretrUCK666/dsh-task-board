/**
 * Standalone build config for the task-board client plugin.
 *
 * Uses the vendored dsh client-bundle preset (shared/tsdown.client.ts + the
 * platform module list in shared/web-platform.ts; keep in sync when the dsh
 * version changes): node-half lib/ plus the browser bundle lib/client.js
 * (closure-factory artifact for the GUI's __ModuleLoader__, CSS Modules inlined
 * with auto-injected <style data-plugin>).
 *
 * Node-half entries point at src (tsdown compiles TS directly), so the build
 * needs no separate tsc emit for runtime artifacts.
 *
 * The client bundle id is the PACKAGE NAME, not the plugin id. The host's
 * client module system locates a row's package, reads its manifest, and keys
 * the served bundle and the __ModuleLoader__ registration by the package name
 * it found (`dsh-client-modules`: `locatePkgJson` → `packageName` → `entry.id`).
 * It then rejects a bundle that registers anything else, with "loaded without
 * registering <name> via __ModuleLoader__.load". The two names happen to agree
 * for an unscoped package, which is why this only broke once the package moved
 * to a scope — the id below must follow package.json's `name`.
 */
import { clientBundle } from './shared/tsdown.client.ts'

/** Package name; must equal package.json `name` and the cordis.patch.yml row `name`. */
const PACKAGE_NAME = '@firetruck666/dsh-task-board'

/**
 * The four host-side entries, one per plugin-page switch.
 *
 * `src/index.ts` is the package row (it carries the browser artifact too);
 * the other three are the modules whose only job is to announce that their
 * surface is switched on. A switch that is not a module of its own cannot be
 * turned off by the plugin page at all, so this list and `cordis.patch.yml`'s
 * rows are the same list written twice — the gate checks they agree.
 */
export default clientBundle(PACKAGE_NAME, [
  'src/index.ts',
  'src/invariant.ts',
  'src/host-board.ts',
  'src/host-items.ts',
  'src/host-agent.ts',
], {
  // `dsh-llm` is external, not inlined: the slash command builds a real
  // UserMessage, and a second inlined copy of that model would be a DIFFERENT
  // type from the host's — the harness's own `instanceof` checks would never
  // match. Same reason cordis is external.
  libExternal: ['@deepseek-ai/dsh-settings', '@deepseek-ai/dsh-llm'],
})
