/**
 * Shared browser platform modules. Seeding, bundling externals, and Vite
 * aliases consume this list so their module identities cannot drift.
 * @module @deepseek-ai/dsh-client-web/src/platform
 */

/**
 * The module specifiers the shell shares into the frozen module table.
 *
 * Mirrors the shell's own seed object — the `react` family, cordis, and the
 * static UI libraries it hands to plugin bundles. A specifier missing here but
 * imported by plugin code fails the bundle purity gate at build time, which is
 * the intended failure: the module table cannot answer a `require` it never
 * seeded, so the alternative is a runtime throw inside the browser.
 *
 * Read from the running shell, never from a remembered version. Locate the seed
 * by searching the dsh-web-frontend `dist/assets` bundles for the
 * `__ModuleLoader__` seed built by the `staticModules` factory, and take its
 * keys: the asset filename is a content hash that changes every release, so the
 * search is by SYMBOL, never by `index-*.js`. Re-check after any host upgrade
 * — a rename here that the seed does not carry is exactly the drift this list
 * exists to prevent. Note this list must NOT be extended just because a package
 * has a `lib/client.js`: only seeded specifiers may be imported as values.
 */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

/** One platform module specifier (a seed-table key). */
export type PlatformModule = (typeof PLATFORM_MODULES)[number]
