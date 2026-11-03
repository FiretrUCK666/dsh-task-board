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

/**
 * What `/task` says when someone presses enter with no sentence after it.
 *
 * ONE LINE, not a paragraph. This branch used to carry a three-step tutorial
 * about building, configuring and running a card — but that teaching already
 * lives in the injected prompt (`tool:taskboard` rules 4 and 5), where it
 * reaches the model on every turn instead of only when somebody submits a blank
 * command. Repeating it here spent the reader's attention on the one screen
 * where they were least stuck: they had the command, they just had not typed the
 * sentence yet.
 */
const TASK_HINT = '在 /task 后面写上你要记的事再发一次，例如「/task 把刚才说的三件事记下来」。'

/** `/task-continue` carries no argument by design: "continue" is a question
 *  about what is outstanding, and an argument would only narrow it wrongly. */
const CONTINUE_PROMPT = '读一下任务清单里还没完成的事项，把它们列出来，然后问我要从哪一条开始。不要替我挑。'

/**
 * THE FIELD THAT DECIDES WHAT HAPPENS WHEN SOMEONE CLICKS `/task` IN THE MENU.
 *
 * The host's command dispatcher keeps two different behaviours behind one
 * boolean, and its own comment names them: 「host input → claim; host bare →
 * detached execute」. A command that declares `input` is CLAIMED — the picker
 * leaves `/task ` in the composer with the caret after it, waiting for the
 * sentence. A command that declares nothing is EXECUTED on the spot with an
 * empty argument.
 *
 * This command shipped without `input`, so clicking it did the second thing: it
 * ran immediately with nothing to hand over, and the only thing it could do was
 * answer with the usage paragraph. To the person clicking it that reads as
 * 「我点了一下，它跑起来了，然后给我一篇说明书」 — the command looked broken
 * because the click behaved like a submit.
 *
 * Declaring `input` fixes the interaction at its source rather than dressing up
 * the empty-argument branch: the click now produces a composer holding `/task `,
 * which is exactly what a command that needs a sentence should do. The hint is
 * the placeholder that says so before anyone has to guess.
 */
const TASK_INPUT = {
  hint: '要记的事，例如：把刚才说的三件事记下来',
} as const

/**
 * The one line `/task` prepends before handing the sentence over.
 *
 * WHY THIS EXISTS — the report that put it here: 「我发出去之后看起来和普通
 * 聊天一模一样」. Measured against the real board, that was literally true: no card
 * had been created, because the model answered in prose and never reached for a
 * tool. The command called itself a door, and a door that only forwards words
 * makes a person unable to tell whether it worked.
 *
 * So the sentence travels with an instruction that names the ONE thing `/task`
 * promises: use the board tools. It is deliberately not a workflow — it does not
 * say which tool, in what order, or with what fields; the model decides that, and
 * the injected `tool:taskboard` section already teaches the three steps. This is
 * only the difference between 「想想这件事」 and 「把它记到板上」, which is the
 * difference the command is supposed to make.
 */
const TASK_DIRECTIVE = '（这是通过 /task 记到任务看板上的请求：请用看板的工具把这件事真的记下来或做掉，不要只用文字回复。）\n\n'

/**
 * Hand one sentence to a session's model.
 *
 * THE ONE PATH from this plugin's COMMANDS into a model. Both slash commands
 * call it, so the two share one `followup`, one message shape and one failure
 * story — a second copy of these four lines is a second thing to keep in step,
 * and the day they drift is the day one of the two paths quietly stops saying
 * what it says. (The checklist panel's 「问 AI」 is a separate path with a
 * different job: it carries a row's own text and starts or continues a card, so
 * it lives in `core/item-ask.ts` rather than being bent into this one.)
 *
 * `lead` is how a caller adds its own instruction without forking the path: the
 * directive travels in the SAME message as the person's words, so the model reads
 * one request rather than two competing ones.
 *
 * Success carries no `text` on purpose: the model answers in the conversation
 * right after this, in its own words and with its own tool cards, and a text
 * here would put a second, weaker rendering of the same turn in front of the
 * person.
 */
export function handOver(agent: CommandAgent, text: string, lead = ''): CommandResult {
  try {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: `${lead}${text}` }], source: { kind: 'user' } }))
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
      input: TASK_INPUT,
      recordInput: false,
      handler: ({ agent, rawInput }) => {
        const text = rawInput.trim()
        /* A BLANK ARGUMENT STILL ARRIVES HERE, and now only one way: the person
           typed `/task` and pressed enter without a sentence. Picking the
           command from the menu no longer reaches this branch at all — the
           `input` claim above keeps the composer open instead.

           So this branch is a fact about a submit, not about a click, and it
           answers in one line instead of a paragraph: the reader is one word
           away from what they wanted, and a wall of text is the last thing that
           helps. `kind: 'success'` is unchanged and load-bearing — the client
           paints `error` red, and nothing failed here. */
        if (text === '') return { kind: 'success', text: TASK_HINT } satisfies CommandResult
        return handOver(agent, text, TASK_DIRECTIVE)
      },
    },
    {
      name: 'task-continue',
      description: '让模型读出清单里未完成的事项，并问你从哪一条开始',
      recordInput: false,
      handler: ({ agent }) => handOver(agent, CONTINUE_PROMPT, TASK_DIRECTIVE),
    },
  ]
}

/** Register both, and return one disposer that takes them both off. */
export function registerTaskboardCommands(registry: CommandRegistrar): () => void {
  const disposers = createTaskboardCommands().map(definition => registry.register(definition))
  return () => { for (const dispose of disposers) dispose() }
}
