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

/** The structural face of one agent (no SDK import beyond the message factory). */
export interface CommandAgent {
  followup(message: unknown): void
}

/** The structural face of the command registry. */
export interface CommandRegistry {
  register(definition: {
    name: string
    description: string
    recordInput?: boolean
    handler(invocation: { agent: CommandAgent; rawInput: string }): { ok: true } | { ok: false; error: { message: string } }
  }): () => void
}

/** `/task` with no argument has nothing to hand over, and a blank door is a
 *  worse experience than being told what the command is for. */
const TASK_HINT = '用法：/task 后面直接写你要记的事，例如「/task 把刚才说的三件事记下来」。我不会替你猜——你原话是什么，我就把什么交给这个会话里的模型。'

/** `/task-continue` carries no argument by design: "continue" is a question
 *  about what is outstanding, and an argument would only narrow it wrongly. */
const CONTINUE_PROMPT = '读一下任务清单里还没完成的事项，把它们列出来，然后问我要从哪一条开始。不要替我挑。'

/** Hand one sentence to the session's model, and report whether it went. */
function handOver(agent: CommandAgent, text: string): { ok: true } | { ok: false; error: { message: string } } {
  try {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    return { ok: true }
  } catch (error) {
    // The registry shows this to the person who typed the command, so it says
    // what went wrong in words rather than swallowing it.
    return { ok: false, error: { message: `这句话没能送进会话：${error instanceof Error ? error.message : String(error)}` } }
  }
}

/** The two command definitions, ready to register. */
export function createTaskboardCommands(): readonly Parameters<CommandRegistry['register']>[0][] {
  return [
    {
      name: 'task',
      description: '把这句话交给当前会话的模型（它看得到这轮对话的上下文）',
      recordInput: false,
      handler: ({ agent, rawInput }) => {
        const text = rawInput.trim()
        if (text === '') return { ok: false, error: { message: TASK_HINT } }
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
export function registerTaskboardCommands(registry: CommandRegistry): () => void {
  const disposers = createTaskboardCommands().map(definition => registry.register(definition))
  return () => { for (const dispose of disposers) dispose() }
}
