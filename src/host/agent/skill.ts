/**
 * The bundled skill: a manual the model opens when it needs one.
 *
 * ── WHY A SKILL AND NOT MORE PROMPT ────────────────────────────────────────
 *
 * The system-prompt section is FIXED TEXT that every conversation carries on
 * every turn, so it has to stay short and it has to contain no capability lists —
 * both for the prompt cache and because a list in there goes stale. That
 * constraint is correct, and it is also why the manual could not live there: how
 * to choose between the board and the checklist, when a run configuration has to
 * be asked about, what a promotion means — that is a page, not a law.
 *
 * A skill is loaded ON DEMAND. Its catalog entry (name + description) is always
 * visible and costs one line; the body arrives only when the model decides it
 * needs it. So the manual costs nothing on 「记一下明天买牛奶」 and is there for
 * 「把这三件事拆成任务并排期」.
 *
 * ── WHY A RUNTIME REGISTRATION, NOT `bundledSkillDir` ──────────────────────
 *
 * `@deepseek-ai/dsh-skill-filesystem` can scan a bundled directory, but that is a
 * CONFIG value in the deployment's profile — setting it would mean this plugin
 * editing somebody else's client configuration, and a second provider root that
 * the user never asked for. `ctx.skills.register()` is the registry's own seam for
 * exactly this: the skill is contributed by the plugin that owns it, and it
 * appears while the plugin is loaded and disappears when it is not.
 *
 * ── THE DEGRADATION ────────────────────────────────────────────────────────
 *
 * A host without a `skills` service, or a package whose files are missing, gets
 * NO skill and a fully working plugin. This is the same rule the workspace face
 * follows: an absent capability means the feature is absent, never that the
 * plugin half-loads or throws during boot.
 *
 * @module dsh-task-board/host/agent/skill
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The skill's kebab-case name — the grammar the registry enforces. */
export const SKILL_NAME = 'taskboard'

/**
 * The description the CATALOG shows, and the only thing the model uses to decide
 * whether to open the skill.
 *
 * The registry caps how much of this is rendered in the session catalog, so it
 * leads with what the skill is FOR and ends with when to reach for it. A
 * description that only names the subject gets skipped on the prompts it was
 * written for.
 */
export const SKILL_DESCRIPTION = '任务看板与清单的操作手册：建卡、跑卡、排期、看板与清单怎么选、运行配置该问不该问的决策。当用户要求记录任务、管理看板、处理清单、设置定时任务时使用。'

/**
 * The narrow face this module needs from the skill registry.
 *
 * Structural, and only the one method used: the plugin reads no skill VALUE from
 * the host package, so a host that renames its types cannot break this module —
 * the same discipline the other structural faces here follow.
 */
export interface SkillRegistrar {
  register(skill: {
    readonly name: string
    readonly description: string
    readonly content: string
    readonly source?: string
    readonly resourceBase?: { readonly kind: 'directory'; readonly path: string }
  }): () => void
}

/** Resolve the packaged skill directory from this module's own location. */
function skillDirectory(): string {
  // `lib/host-agent.js` sits one level under the package root, and the sources
  // run from `src/host/agent/`. Both resolve to the same `skills/taskboard`, so
  // the walk is written as "find the package root" rather than a fixed `..`
  // count — a build that moves the output one directory deeper would otherwise
  // silently stop finding the skill.
  const here = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(here, ...Array.from({ length: depth }, () => '..'), 'skills', 'taskboard')
    try {
      readFileSync(join(candidate, 'SKILL.md'), 'utf8')
      return candidate
    } catch {
      // Try one level further up; the package root is at most a few away.
    }
  }
  return join(here, '..', '..', 'skills', 'taskboard')
}

/**
 * Read the packaged skill, or say why it is absent.
 *
 * @returns the parts the registry takes, or undefined when the files are not
 *   shipped in this build — in which case the caller registers nothing at all.
 */
export function bundledSkill(): { name: string; description: string; content: string; resourceBase: { kind: 'directory'; path: string } } | undefined {
  const directory = skillDirectory()
  let raw: string
  try {
    raw = readFileSync(join(directory, 'SKILL.md'), 'utf8')
  } catch {
    // NOT AN ERROR. A deployment that strips non-code files still works; the
    // manual is a convenience, and a plugin that refuses to boot over a missing
    // README is a worse trade than one without the manual.
    return undefined
  }
  // The body is everything after the frontmatter: the registry keeps the
  // description as metadata, and leaving YAML in the instructions would show it
  // to the model as prose.
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  const content = frontmatter === null ? raw : raw.slice(frontmatter[0].length)
  // The description comes from the CONSTANT, not from the file: the catalog entry
  // is what the model decides on, so it must be readable by this module's tests
  // and not only inside a markdown file. The file's own copy is checked by the
  // gate that keeps the two equal.
  return {
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    content: content.trim(),
    // Relative links inside the manual (`references/actions.md`) resolve against
    // this, which is why it must be the ABSOLUTE directory.
    resourceBase: { kind: 'directory', path: directory.split('\\').join('/') },
  }
}

/**
 * Register the bundled skill.
 *
 * @param registrar - the skill registry, when the host composes one.
 * @returns the disposer, or a no-op when there is nothing to register.
 */
export function registerTaskboardSkill(registrar: SkillRegistrar | undefined): () => void {
  if (registrar === undefined) return () => undefined
  const skill = bundledSkill()
  if (skill === undefined) return () => undefined
  return registrar.register({ ...skill, source: 'bundled' })
}
