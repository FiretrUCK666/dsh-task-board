/**
 * Command palette model: the board's actions as a filterable list. Every
 * command reuses an existing handler (new-task modal, cruise toggle,
 * organize mode, automation overview, notifications, back-to-chat) — the
 * palette adds NO new behavior, only a keyboard-first entrance (Ctrl/Cmd+K).
 * Pure and framework-free so the list unit-tests in isolation.
 */

/** One palette row: a stable id, a localized label, an optional hint, and the run. */
export interface PaletteCommand {
  id: 'new' | 'cruise' | 'organize' | 'automation' | 'notify' | 'close'
  label: string
  run(): void
}

/** The UI actions the palette triggers (the caller's own setters/handlers). */
export interface PaletteActions {
  cruiseEnabled: boolean
  openNew(): void
  toggleCruise(): void
  openOrganize(): void
  openAutomation(): void
  openNotify(): void
  closeBoard(): void
}

/** Build the six commands in palette order (labels via the caller's `t`). */
export function buildCommands(
  t: (key: 'board.new' | 'board.cruiseOn' | 'board.cruiseOff' | 'board.organize' | 'board.automation' | 'board.notify' | 'board.close') => string,
  actions: PaletteActions,
): PaletteCommand[] {
  return [
    { id: 'new', label: t('board.new'), run: actions.openNew },
    {
      id: 'cruise',
      label: actions.cruiseEnabled ? t('board.cruiseOff') : t('board.cruiseOn'),
      run: actions.toggleCruise,
    },
    { id: 'organize', label: t('board.organize'), run: actions.openOrganize },
    { id: 'automation', label: t('board.automation'), run: actions.openAutomation },
    { id: 'notify', label: t('board.notify'), run: actions.openNotify },
    { id: 'close', label: t('board.close'), run: actions.closeBoard },
  ]
}

/** Filter commands by a raw query (multi-term AND over the label, case-insensitive). */
export function filterCommands(commands: readonly PaletteCommand[], query: string): PaletteCommand[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(term => term !== '')
  if (terms.length === 0) return [...commands]
  return commands.filter(command => {
    const label = command.label.toLowerCase()
    return terms.every(term => label.includes(term))
  })
}
