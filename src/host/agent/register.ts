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
import { createTaskboardTools, type ToolDeps } from './tools.ts'
import { registerTaskboardCommands, type CommandRegistrar } from './commands.ts'
import { registerTaskboardPromptSection, type PromptSectionTarget } from './prompt.ts'

/** Read the host's live services at call time, never at registration time. */
function postureSources(ctx: Context): SessionPostureSources {
  return {
    agents: () => ctx.get('agents') as { get(id: string): { status?: unknown } | undefined } | undefined,
    workspaceRegistry: () => ctx.get('workspaceRegistry') as { archivedSessionIds?: readonly string[] } | undefined,
    sessionQuery: () => ctx.get('sessionQuery') as { readSession(id: string): Promise<{ events?: unknown }> } | undefined,
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
  const deps: ToolDeps = {
    board: () => documentService,
    posture: (sessionId: string) => sessionPostureOf(sources, questionWaits, sessionId),
    // The SAME live faces the posture derivation reads, so a decision the model
    // triggers asks the board's derivation rather than a second one.
    sources,
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

  return () => { for (const dispose of disposers.reverse()) dispose() }
}
