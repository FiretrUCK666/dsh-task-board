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
 * Verified against DSH 0.1.6-alpha.2 (`dsh-web-frontend/dist/assets/index-*.js`,
 * the `__ModuleLoader__` seed built by the `staticModules` factory): that table
 * carries exactly the keys listed below (react family, cordis, four
 * `dsh-client-*` modules). Re-check it whenever the host version moves
 * — a rename here that the table does not carry is exactly the drift this list
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
