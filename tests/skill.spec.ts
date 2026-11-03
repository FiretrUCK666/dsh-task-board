/**
 * THE BUNDLED SKILL: a manual the model opens when it needs one.
 *
 * Two things are being protected here, and they are different kinds of claim:
 *
 *  1. **The split** — the skill carries DECISIONS and never a field list. A
 *     skill that listed the actions would be a second copy of the catalog, which
 *     is exactly what the catalog exists to prevent, and it would go stale
 *     silently (the body is prose; nothing re-renders it).
 *  2. **The registration** — it is contributed by the plugin that owns it, it
 *     degrades to nothing when the host has no skill service, and it never
 *     throws during boot over a missing file.
 *
 * The generated `references/actions.md` is the one place field detail lives, and
 * `gen-skill-actions.mjs --check` is what keeps it from describing a previous
 * version of the catalog.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SKILL_DESCRIPTION, SKILL_NAME, bundledSkill, registerTaskboardSkill } from '../src/host/agent/skill.ts'
import { ACTIONS } from '../src/core/board-actions.ts'

const SKILL_DIR = join(process.cwd(), 'skills', 'taskboard')

describe('the skill the plugin ships', () => {
  it('ships a kebab-case name the registry will accept', () => {
    // The registry drops a whole skill whose name is not kebab-case, and it does
    // so without a word — the skill simply never appears in the catalog.
    expect(SKILL_NAME).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(SKILL_NAME).toBe('taskboard')
  })

  it('has a description that says WHEN to use it, not only what it is', () => {
    // The catalog line is the ONLY thing the model decides on, so a description
    // that only names the subject gets skipped on the prompts it was written for.
    expect(SKILL_DESCRIPTION).toContain('当用户')
    expect(SKILL_DESCRIPTION.length).toBeGreaterThan(20)
  })

  it('reads the body and keeps the frontmatter out of the instructions', () => {
    const skill = bundledSkill()
    expect(skill, 'the packaged skill could not be read — the files are not shipped').toBeDefined()
    if (skill === undefined) return
    // A model shown raw YAML learns nothing and reads it as prose. `---` alone is
    // not the test: markdown tables use it too, and asserting on the bare string
    // would forbid a table in a manual that needs one.
    expect(skill.content).not.toMatch(/^---\r?\n/)
    expect(skill.content).not.toMatch(/^(name|description):\s/m)
    expect(skill.content.startsWith('# 任务看板'), 'the body does not begin at the title').toBe(true)
    expect(skill.content).toContain('看板还是清单')
    // The resources are resolved against the packed directory, so the relative
    // link to the generated reference actually opens.
    expect(skill.resourceBase.kind).toBe('directory')
    expect(skill.resourceBase.path.replace(/\\/g, '/')).toContain('skills/taskboard')
  })

  it('carries DECISIONS, and no field list', () => {
    // The split AGENTS.md rule 22 states: the skill answers 「这种场景怎么组合」,
    // never 「有哪些动作」. A skill listing the actions would be a second copy of
    // the catalog — stale the moment the catalog moves, and silent about it,
    // because prose is not re-rendered by anything.
    const body = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')
    const named = Object.keys(ACTIONS).filter(id => body.includes(id))
    expect(named, `the skill names catalog actions (${named.join(', ')}), which is the second copy rule 22 forbids`).toEqual([])
    // And it does answer the decisions, or it is not a manual.
    expect(body).toContain('清单是收件箱，看板是工作台')
    expect(body).toContain('提升不是移动')
  })

  it('states the run-configuration rule, which is the measured defect', () => {
    // Six of seven cards on this machine had NO run configuration, and the
    // catalog's identical sentence for six fields is why. The manual has to say
    // which two must be asked about.
    const body = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')
    expect(body).toContain('按后果分级')
    expect(body).toContain('先问这两项')
    // And the anti-pattern, in the words that make it recognisable.
    expect(body).toContain('记一下明天买牛奶')
  })

  it('keeps the frontmatter description equal to the constant the catalog publishes', () => {
    // `skill.ts` says 「The file's own copy is checked by the gate that keeps the two
    // equal」. It was not: the constant is what the session catalog shows, and the
    // file's frontmatter is what a reader sees after opening the skill — two model
    // -visible copies of one sentence, with nothing keeping them in step. A comment
    // claiming a gate that does not exist is the 「假线索」 hard rule 22 names, and it
    // is worse than no comment: the next person changes one copy and believes it is
    // checked.
    //
    // This IS that gate, and it lives here because hard rule 16 says a gate is
    // proven by planting it in `tests/`.
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')
    const front = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw)?.[1] ?? ''
    const described = /^description:\s*(.+)$/mu.exec(front)?.[1]?.trim() ?? ''
    expect(described, 'the skill file has no description in its frontmatter').not.toBe('')
    expect(described, 'the catalog description and the file description have drifted apart').toBe(SKILL_DESCRIPTION)
    const named = /^name:\s*(.+)$/mu.exec(front)?.[1]?.trim() ?? ''
    expect(named, 'the frontmatter name and the registered name have drifted apart').toBe(SKILL_NAME)
  })

  it('names no field the catalog owns', () => {
    // The manual says 「字段名、枚举值一律不写在这里」. It then wrote `prompt` in
    // backticks — a real task parameter. The existing guard only scanned ACTION
    // IDS, so a renamed parameter would leave the manual teaching a name that no
    // longer exists while every gate stayed green.
    const body = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')
    // Every parameter name the catalog declares, minus the ones that are also
    // ordinary words in a sentence about task boards.
    const params = new Set<string>()
    for (const action of Object.values(ACTIONS)) {
      for (const name of Object.keys(action.params)) params.add(name)
    }
    const quoted = [...body.matchAll(/`([A-Za-z_][\w.]*)`/g)].map(match => match[1])
    const offenders = quoted.filter(token => params.has(token))
    expect(offenders, `the manual names catalog fields in backticks (${offenders.join(', ')}) — that is the second copy rule 22 forbids`).toEqual([])
  })

  it('keeps the directory small enough to be worth loading', () => {
    // The body is injected when it is opened, so it is not free. The budget is a
    // design constraint, not a formatting preference: at some size the manual is
    // the capability table again under a different name.
    const bytes = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8').length
    expect(bytes, `SKILL.md is ${bytes} bytes — a manual this long costs more than the lookup it replaces`).toBeLessThan(6000)
    expect(bytes).toBeGreaterThan(1500)
  })
})

describe('registering it degrades instead of throwing', () => {
  it('does nothing when the host has no skill service', () => {
    // A deployment that composes tools but no skills is a working host: the manual
    // is a convenience, and a plugin that refused to boot over it would be a worse
    // trade.
    expect(() => registerTaskboardSkill(undefined)()).not.toThrow()
  })

  it('registers once and hands back the registry\'s own disposer', () => {
    const registered: string[] = []
    let disposed = 0
    const dispose = registerTaskboardSkill({
      register: (skill) => {
        registered.push(skill.name)
        return () => { disposed += 1 }
      },
    })
    expect(registered).toEqual([SKILL_NAME])
    dispose()
    expect(disposed, 'the disposer did not reach the registry').toBe(1)
  })

  it('reports the files as absent rather than pretending when the package strips them', () => {
    // `bundledSkill()` returning undefined is the honest answer for a build that
    // ships only code, and the registration path treats it as "nothing to do"
    // rather than "register an empty skill".
    const skill = bundledSkill()
    if (skill !== undefined) expect(skill.content.trim().length).toBeGreaterThan(0)
  })
})
