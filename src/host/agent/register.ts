/**
 * Wiring for the agent surface: the three tools, the two commands and the one
 * prompt section, registered from a single entry point.
 *
 * It exists as its own module so `src/index.ts` keeps its one-import-per-route
 * shape and so the whole surface can be torn down with ONE disposer. Three
 * separate effects would mean three ways for half a surface to exist.
 *
 * The board document the tools write is the SAME service object the routes
 * serve — acquired from the process hub, never constructed here (one unit,
 * one live handle, one write lane) — so an action the model takes converges
 * on every device by the same path a click does.
 */
import type { Context } from '@deepseek-ai/cordis'
import { acquireBoardService, storageHubOpener } from '../board-service.ts'
import { attachQuestionWaitRecorder, createQuestionWaitRecorder, sessionPostureOf, type SessionPostureSources } from '../session-state.ts'
import { createTaskboardTools, type ParamResolver, type ToolDeps } from './tools.ts'
import { candidatesFor, resolveValue, type ResolveCandidate, type ResolveKind } from '../../core/resolve.ts'
import { registerTaskboardCommands, type CommandRegistrar } from './commands.ts'
import { registerTaskboardPromptSection, type PromptSectionTarget } from './prompt.ts'
import { registerTaskboardSkill, type SkillRegistrar } from './skill.ts'

/** Read the host's live services at call time, never at registration time. */
function postureSources(ctx: Context): SessionPostureSources {
  return {
    agents: () => ctx.get('agents') as { get(id: string): { status?: unknown } | undefined } | undefined,
    workspaceRegistry: () => ctx.get('workspaceRegistry') as { archivedSessionIds?: readonly string[] } | undefined,
    sessionQuery: () => ctx.get('sessionQuery') as { readSession(id: string): Promise<{ events?: unknown }> } | undefined,
  }
}

/**
 * The workspace titles this host knows, keyed by id.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 *
 * `ToolDeps.workspaceTitle` has always been declared and documented — 「a
 * workspace's display name, when this host knows one」 — and was NEVER WIRED. Two
 * surfaces paid for that, and neither said a word:
 *
 *  · A card's run configuration printed a UUID where the interface shows
 *    「DeepSeek default」, so a model asked to build a card 「in the same workspace
 *    as that one」 had to copy an identifier it cannot read.
 *  · `ws:` — an advertised filter value — was DEAD. `matchQualifier` reads
 *    `facets.workspaceTitle ?? ''`, so with the face absent the qualifier matched
 *    the empty string and no card could ever pass it. A documented filter that
 *    silently matches nothing is worse than no filter: the caller cannot tell
 *    「none」 from 「I used it wrong」.
 *
 * Read live on every call, never cached: a workspace renamed in the shell must
 * show up in the next query, and a cache here would be a second truth about a
 * name the host owns. Absent service = absent face (the honest degradation the
 * declaration describes), never an invented name.
 * @param ctx - the host root context.
 * @returns a lookup, or undefined when this deployment has no workspace registry.
 */
function workspaceTitles(ctx: Context): ((workspaceId: string) => string) | undefined {
  // `Workspace` is `{ id, path, title, createdAt, updatedAt, … }` (see
  // `@deepseek-ai/dsh-workspace`'s types). `workspaceId` is accepted too because a
  // card's field and a shell snapshot have both been spelled that way in this
  // tree; the two are compared rather than one being assumed, which costs one
  // comparison and cannot pick the wrong row.
  const registry = ctx.get('workspaceRegistry') as { list?(): readonly { workspaceId?: unknown; id?: unknown; title?: unknown }[] } | undefined
  if (registry === undefined || typeof registry.list !== 'function') return undefined
  return (workspaceId: string): string => {
    let rows: readonly { workspaceId?: unknown; id?: unknown; title?: unknown }[]
    try {
      rows = registry.list?.() ?? []
    } catch {
      // A registry that throws is 「I cannot read it」, and the caller's own rule is
      // that an unreadable name is not a name — so fall through to the id rather
      // than reporting a workspace called 「undefined」.
      return workspaceId
    }
    const row = rows.find(entry => entry.workspaceId === workspaceId || entry.id === workspaceId)
    const title = typeof row?.title === 'string' ? row.title.trim() : ''
    // The id is the honest fallback: it is what the caller gave us, and a made-up
    // label would be a name no surface can resolve back to a workspace.
    return title === '' ? workspaceId : title
  }
}

/**
 * Assemble the vocabulary bridge from the two sources that own the words.
 *
 * ── WHY THE CANDIDATES ARE READ LIVE, NEVER WRITTEN HERE ────────────────────
 *
 * `status` and `priority` come from this repository's own enums (`core/resolve`
 * builds them from `ITEM_STATUS_VIEWS` / `ITEM_PRIORITIES`), so they cannot drift
 * from the columns and the tiers. `permission` and `agentPreset` are the
 * DEPLOYMENT's vocabulary: its preset table is the authority, it changes without
 * this plugin, and a list typed here would be stale the first time somebody edits
 * a profile — silently, because a wrong option list still renders.
 *
 * Read at CALL time, not at registration time: a preset added while the host is
 * running must be resolvable in the next call, and a snapshot taken at boot would
 * be a second truth about a name the deployment owns.
 *
 * @param ctx - host root context.
 * @returns the resolver face, or undefined when no source can be read.
 */
function paramResolver(ctx: Context): ParamResolver | undefined {
  /** The permission catalog, from the same service the browser half's selector reads. */
  const permissions = (): readonly ResolveCandidate[] => {
    const service = ctx.get('permissionPresets') as { names?: readonly string[]; optionOf?(name: string): { value: string; name: string } } | undefined
    if (service === undefined || !Array.isArray(service.names)) return []
    return service.names.map(name => {
      // `optionOf` is the snapshot the selector uses; a name it cannot describe is
      // still a legal key, so it is kept with the key as its label.
      let label: string | undefined
      try {
        label = service.optionOf?.(name).name
      } catch {
        label = undefined
      }
      return { value: name, spellings: label === undefined ? [name] : [name, label], ...label === undefined ? {} : { label } }
    })
  }
  /** Agent presets, from the registry the shell's own picker reads. */
  const presets = (): readonly ResolveCandidate[] => {
    const registry = ctx.get('agentPresets') as { roster?(): unknown } | undefined
    if (registry === undefined) return []
    let rows: unknown
    try {
      rows = registry.roster?.()
    } catch {
      return []
    }
    // The roster's shape is the host's, so it is read structurally and every
    // field is optional: a shape this cannot read yields no candidates, which is
    // 「this host cannot tell you」 rather than a wrong list.
    const list = Array.isArray(rows) ? rows : []
    const out: ResolveCandidate[] = []
    for (const row of list) {
      if (typeof row !== 'object' || row === null) continue
      const id = (row as { id?: unknown }).id
      if (typeof id !== 'string' || id === '') continue
      const name = (row as { name?: unknown }).name
      const label = typeof name === 'string' && name !== '' ? name : undefined
      out.push({ value: id, spellings: label === undefined ? [id] : [id, label], ...label === undefined ? {} : { label } })
    }
    return out
  }
  return {
    resolve: (kind: ResolveKind, value: unknown): string | undefined => {
      const fromHost = kind === 'permission' ? permissions()
        : kind === 'agentPreset' ? presets()
          // `workspace` and `model` need the id↔name pairs the models route owns;
          // until that read is wired, the built-in rule applies and their strict
      // reading is unchanged — an honest gap, not a silent one.
          : []
      const candidates = candidatesFor(kind, fromHost)
      if (candidates.length === 0) return undefined
      const resolved = resolveValue(kind, value, { candidatesOf: () => candidates })
      return resolved.ok ? resolved.value : undefined
    },
  }
}

/**
 * Register everything the model needs, and take it all off with the returned
 * disposer. A host that composes none of the three services registers nothing
 * rather than half of something.
 * @returns the disposer removing all registrations.
 */
export function registerTaskboardAgentSurface(ctx: Context): () => void {
  // `commands` and `systemPrompt` carry the host's OWN payload types, so a
  // wiring mistake here is a compile error rather than the runtime refusal a
  // hand-drawn shape earned. `tools` keeps a narrow face for now: its real
  // `ToolDefinition` is the next knife, and widening this one without the
  // payload would only move the lie.
  const tools = ctx.get('tools') as { register(definition: unknown): () => void } | undefined
  const commands = ctx.get('commands') as CommandRegistrar | undefined
  const systemPrompt = ctx.get('systemPrompt') as PromptSectionTarget | undefined
  // The skill registry is read BY NAME and may be absent: a deployment without it
  // loses the manual and nothing else. It is NOT part of the all-or-nothing group
  // below, because a host that composes tools but no skills is a working host.
  const skills = ctx.get('skills') as SkillRegistrar | undefined
  if (tools === undefined && commands === undefined && systemPrompt === undefined) {
    // Every injection is a liability: a deployment without these host services
    // gets a board and no agent surface, which is a working product.
    return () => undefined
  }

  // The SAME handle the browser routes serve — acquired, never constructed
  // (see acquireBoardService): the platform gives this unit exactly one live
  // handle, so an agent row that opened its own would steal the truth out from
  // under the board row, or lose the race and serve fallback mode itself.
  const { service: documentService, release: releaseBoardService } = acquireBoardService(storageHubOpener(() => ctx.get('storage')))
  const sources = postureSources(ctx)
  const titles = workspaceTitles(ctx)
  const deps: ToolDeps = {
    board: () => documentService,
    posture: (sessionId: string) => sessionPostureOf(sources, questionWaits, sessionId),
    // The SAME live faces the posture derivation reads, so a decision the model
    // triggers asks the board's derivation rather than a second one.
    sources,
    // Only when the host can actually answer: an absent registry means the face
    // is absent, and `ws:` then stays unavailable rather than matching nothing.
    ...titles === undefined ? {} : { workspaceTitle: titles },
    // The vocabulary bridge. Always supplied: the built-in vocabularies (status,
    // priority) need no host service, so even a bare deployment resolves those.
    resolver: paramResolver(ctx),
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),
  }

  // The question bypass: observe the in-flight waterfall without ever claiming
  // it, so "waiting for an answer" is a fact this host can see.
  const questionWaits = createQuestionWaitRecorder()
  const detachQuestions = tools === undefined ? () => undefined : attachQuestionWaitRecorder(ctx as never, questionWaits)

  const disposers: (() => void)[] = [detachQuestions, releaseBoardService]
  if (tools !== undefined) {
    for (const tool of createTaskboardTools(deps)) disposers.push(tools.register(tool))
  }
  if (commands !== undefined) disposers.push(registerTaskboardCommands(commands))
  if (systemPrompt !== undefined) disposers.push(registerTaskboardPromptSection(systemPrompt))
  // The manual, contributed by the plugin that owns it rather than by a config
  // value in somebody else's profile. Absent registry or absent files = no skill,
  // and the plugin is otherwise unchanged.
  disposers.push(registerTaskboardSkill(skills))

  return () => { for (const dispose of disposers.reverse()) dispose() }
}
