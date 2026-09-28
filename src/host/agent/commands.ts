/**
 * The two slash commands (host half): `/task` and `/task-continue`.
 *
 * ── WHAT A COMMAND IS NOT ──────────────────────────────────────────────────
 *
 * A command here is a DOOR, not a pipeline. It takes what the person typed and
 * hands that sentence to the model **in the session they were already talking
 * in** — no fixed pipeline, no pre-filled input box, no second copy of the
 * conversation. The whole reason this works is that the conversation history
 * is already in that session: a model asked to "write down the three things we
 * just discussed" can see them without this plugin relaying a single one.
 *
 * So the handler does exactly three things: take the words, hand them over,
 * say nothing. Anything smarter here would be a workflow the model has to
 * fight, and a workflow that has to be kept in step with the board is a second
 * set of rules — which is the thing this whole project is removing.
 *
 * `recordInput: false`: the sentence is already a message in this session, so
 * recording it again as the command's own input would put the same words in the
 * log twice. It is a payload someone else owns.
 *
 * `/task-continue` differs in exactly one way: it is a prompt, not a blank
 * door. The model is asked to read the outstanding items and ask where to
 * start, because "continue" without knowing what is outstanding is a guess.
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { CommandDefinition, CommandResult } from '@deepseek-ai/dsh-commands'

/** The structural face of one agent. The COMMAND types below are the host's
 *  own, imported — a hand-written copy of them compiles just as happily and
 *  fails on the first real invocation, which is exactly what happened. */
export interface CommandAgent {
  followup(message: unknown): void
}

/** What this module needs from the command registry: one method, taking the
 *  host's own {@link CommandDefinition}. Narrow to a single method so tests
 *  can supply a face — but the DEFINITION it accepts is the real type, so a
 *  face cannot invent a handler contract the host will not honour. */
export interface CommandRegistrar {
  register(definition: CommandDefinition): () => void
}

/** `/task` with no argument has nothing to hand over, and a blank door is a
 *  worse experience than being told what the command is for. */
const TASK_HINT = '用法：/task 后面直接写你要记的事，例如「/task 把刚才说的三件事记下来」。我不会替你猜——你原话是什么，我就把什么交给这个会话里的模型。'

/** `/task-continue` carries no argument by design: "continue" is a question
 *  about what is outstanding, and an argument would only narrow it wrongly. */
const CONTINUE_PROMPT = '读一下任务清单里还没完成的事项，把它们列出来，然后问我要从哪一条开始。不要替我挑。'

/**
 * Hand one sentence to a session's model.
 *
 * THE ONE PATH from this plugin into a model. Both slash commands call it, and
 * so does the panel's one-click hand-off (`/board/ask`), because the reader is
 * asking for the same thing in two places: one `followup`, one message shape,
 * one failure story. A second copy of these four lines is a second thing to keep
 * in step, and the day they drift is the day one of the two paths quietly
 * stops saying what it says.
 *
 * Success carries no `text` on purpose: the model answers in the conversation
 * right after this, in its own words and with its own tool cards, and a text
 * here would put a second, weaker rendering of the same turn in front of the
 * person.
 */
export function handOver(agent: CommandAgent, text: string): CommandResult {
  try {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    return { kind: 'success' }
  } catch (error) {
    // The registry shows this to the person who typed the command, so it says
    // what went wrong in words rather than swallowing it.
    return { kind: 'error', text: `这句话没能送进会话：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** The two command definitions, ready to register. */
export function createTaskboardCommands(): readonly CommandDefinition[] {
  return [
    {
      name: 'task',
      description: '把这句话交给当前会话的模型（它看得到这轮对话的上下文）',
      recordInput: false,
      handler: ({ agent, rawInput }) => {
        const text = rawInput.trim()
        if (text === '') return { kind: 'error', text: TASK_HINT } satisfies CommandResult
        return handOver(agent, text)
      },
    },
    {
      name: 'task-continue',
      description: '让模型读出清单里未完成的事项，并问你从哪一条开始',
      recordInput: false,
      handler: ({ agent }) => handOver(agent, CONTINUE_PROMPT),
    },
  ]
}

/** Register both, and return one disposer that takes them both off. */
export function registerTaskboardCommands(registry: CommandRegistrar): () => void {
  const disposers = createTaskboardCommands().map(definition => registry.register(definition))
  return () => { for (const dispose of disposers) dispose() }
}
