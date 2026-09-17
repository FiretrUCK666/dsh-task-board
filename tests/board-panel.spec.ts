/**
 * Board stage contract: the board's seat is the shell's OFFICIAL centre-stage
 * panel, its entry is the shell's own panel row, and NOTHING in the plugin
 * guesses shell DOM or shell class names to get there.
 *
 * Why this is a test and not just a comment: the board used to mount itself by
 * hunting for `[data-pane="conversation"]` and appending a React root into the
 * shell's own grid item. The host removed that attribute; the fallback
 * (`[class*="centerCol"]`) matched a CSS-Module hash that changes whenever the
 * shell rebuilds. The board silently stopped appearing, nothing threw, and every
 * automated check stayed green. These assertions pin the STRUCTURE that replaced
 * it, and refuse the old approach by name.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/**
 * Drop comments so a ban applies to CODE, not prose.
 *
 * The ban below forbids shell-DOM guesses. The modules that removed them also
 * DOCUMENT them (that is how a future reader learns why they are gone), so a
 * naive substring search would forbid the explanation along with the practice.
 * CSS is returned untouched — `/* *​/` is its only comment form and the sheet has
 * no banned string in prose anyway.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('board stage (official main panel)', () => {
  const client = read('../src/client/index.ts')
  const panel = read('../src/client/TaskBoardPanel.tsx')
  const icon = read('../src/client/TaskBoardIcon.tsx')

  it('registers the board into the official `main` slot under a single shared id', () => {
    // The keyed main slot IS the centre stage; `activePanelId === null` means the
    // Conversation. The id is declared once (GROUP) so the two registrations
    // cannot drift: the shell resolves a panel ROW to its STAGE by this id.
    expect(client).toContain("const GROUP = { id: 'dsh-task-board' } as const")
    expect(client).toContain("ctx.slots.inject('main'")
    expect(client).toContain('key: GROUP.id')
    expect(client).toContain("ctx.slots.inject('sidebar.panellist'")
    expect(client).toContain('id: GROUP.id')
  })

  it('contributes the panel with a component, an inject face and no children table', () => {
    // A dynamically loaded plugin must not declare child slots: the shell only
    // accepts a children table from entries it composes itself.
    expect(client).not.toMatch(/children:\s*\{/)
    expect(panel).toContain('data-dsh-taskboard-view=""')
    // The panel is contributed at apply time while the board is built later, so
    // "not ready" must be a rendered state rather than a reason not to register:
    // the prop admits absence and the absent case renders the loading line.
    expect(panel).toMatch(/BoardController\s*\|\s*undefined/)
    expect(panel).toContain('controller === undefined')
    expect(panel).toContain("t('board.loading')")
  })

  it('renders the board only from props — never creates its own React root', () => {
    // `createRoot` into shell DOM was the old strategy; the shell owns rendering
    // now, so a second root inside its tree would be a bug, not a workaround.
    const code = stripComments(panel)
    expect(code).not.toContain('createRoot')
    expect(code).not.toContain('MutationObserver')
    expect(code).toContain('useEffect')
  })

  it('keeps the board box a named size container (the responsive contract is unchanged)', () => {
    const css = read('../src/client/board.module.css')
    expect(css).toMatch(/\[data-dsh-taskboard-view\]\s*\{[\s\S]*?container-type:\s*inline-size/)
    expect(css).toMatch(/\[data-dsh-taskboard-view\]\s*\{[\s\S]*?container-name:\s*dsh-tb/)
    // No viewport media queries in the board's own sheet.
    expect(css).not.toMatch(/@media\s*\(max-width/)
  })

  it('draws only its own glyph and lets the shell own the panel row', () => {
    // The shell owns the button, its geometry, hover/active fill, the selected
    // highlight and the label; a second row implementation would drift from the
    // native entries (the rejected alternative).
    expect(icon).toContain('size: number')
    expect(icon).toContain('active: boolean')
    expect(icon).not.toMatch(/addEventListener|querySelector/)
  })

  it('has no DOM-guessing mount module left in the tree', () => {
    expect(existsSync(fileURLToPath(new URL('../src/client/board-mount.tsx', import.meta.url)))).toBe(false)
    expect(existsSync(fileURLToPath(new URL('../src/client/SidebarFooter.tsx', import.meta.url)))).toBe(false)
  })

  it('never reads a shell class name or a removed shell attribute (source-level ban)', () => {
    // The banned strings are the historical guesses, named explicitly so a
    // future "quick fix" cannot reintroduce them quietly. They are assembled from
    // fragments so this spec does not itself contain them.
    const banned = [
      ['data', 'pane'].join('-'),
      ['center', 'Col'].join(''),
      ['data-dsh-taskboard', 'active'].join('-'),
    ]
    const sources = [
      ['../src/client/index.ts', stripComments(client)],
      ['../src/client/TaskBoardPanel.tsx', stripComments(panel)],
      ['../src/client/TaskBoardIcon.tsx', stripComments(icon)],
      ['../src/client/board.module.css', read('../src/client/board.module.css')],
    ] as const
    for (const [name, text] of sources) {
      for (const needle of banned) {
        expect(text.includes(needle), `${name} must not reference "${needle}"`).toBe(false)
      }
    }
  })

  it('leaves the board open state to the panel mount lifetime (one source of truth)', () => {
    // The controller's boardOpen mirrors "this panel is mounted", so the stage
    // and the snapshot cannot disagree; leaving goes through the shell's panel
    // API instead of flipping a boolean the shell never reads.
    expect(panel).toContain('controller.openBoard()')
    expect(panel).toContain('controller.closeBoard()')
    const controller = read('../src/core/controller.ts')
    expect(controller).toContain('showConversation()')
    expect(controller).not.toContain('toggleBoard')
  })
})
