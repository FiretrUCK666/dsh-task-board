/**
 * The slash commands (host half): the four doors into a session's model.
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
 * So a handler does three things: take the words, hand them over, say nothing.
 * Anything smarter here would be a workflow the model has to fight, and a
 * workflow that has to be kept in step with the board is a second set of rules —
 * which is the thing this whole project is removing.
 *
 * `recordInput: false`: the sentence is already a message in this session, so
 * recording it again as the command's own input would put the same words in the
 * log twice. It is a payload someone else owns.
 *
 * ── THE FOUR, AND THE ONE THING EACH IS FOR ────────────────────────────────
 *
 * A command's directive is the only place its OWN job is stated, and the reason
 * each needs its own is that a shared one lied. Every command used to travel with
 * the same sentence — 「请用看板的工具把这件事真的记下来」 — which is a correct
 * instruction for `/task` and a wrong one for the other three: 「继续」 is not
 * 「记下来」, 「现在什么情况」 is not a write at all, and 「清理一下」 that starts
 * by creating cards has made the mess bigger. A directive that names the wrong job
 * is worse than none, because the model follows it.
 *
 * So the four are: `/task` (hand this sentence over, and judge where it belongs),
 * `/task-continue` (resume outstanding work), `/task-status` (report the state of
 * BOTH surfaces), `/task-cleanup` (tidy up BOTH surfaces, with the three delete
 * costs kept apart).
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { CommandDefinition, CommandResult } from '@deepseek-ai/dsh-commands'
import { messageOf } from '../../core/values.ts'

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
 * THE ONE LINE `/task` PREPENDS — AND WHAT IT DELIBERATELY DOES NOT SAY.
 *
 * How it got here: 「我发出去之后看起来和普通聊天一模一样」. Measured against the
 * real board that was literally true — no card had been created, because the
 * model answered in prose and never reached for a tool. A door that only forwards
 * words leaves a person unable to tell whether it worked.
 *
 * So the sentence travels with an instruction: use the board tools, and actually
 * record or do the thing rather than describing it.
 *
 * ── WHY IT NO LONGER SAYS 「记到看板上」 ──────────────────────────────────────
 *
 * The first version did, and it was WRONG for the commonest case. 「记一下明天买
 * 牛奶」 is a checklist entry; 「把刚才那三件事拆成任务并排期」 is a board card.
 * A directive that says `board` makes the model build a CARD for a shopping
 * reminder — a card is a thing that gets EXECUTED, so the board fills with
 * reminders that look like work waiting to run, and the person has to undo it by
 * hand. That is the plugin creating the mess the person asked it to absorb.
 *
 * `/task` cannot decide which surface, and it should not try: the two-document
 * rule (a checklist entry is a thought, a card is a commitment) is a judgment
 * about the person's intent, and the manual in `skills/taskboard/SKILL.md` is
 * where that judgment is taught. So the directive states the JOB — actually use
 * the tools, and put it where it belongs — and names both surfaces so neither is
 * forgotten.
 */
const TASK_DIRECTIVE = '（这是通过 /task 发出的请求：请用任务看板与任务清单的工具真的把它处理掉，不要只用文字回复。'
  + '放看板还是放清单由你按它的性质判断——要真的去做的是卡，只是先记着的是清单条目——判断不了就问一句。'
  + '具体的判断标准和字段用法查 taskboard 技能或 taskboard_capabilities。）\n\n'

/**
 * `/task-continue`: RESUME WHAT IS OUTSTANDING, on both surfaces.
 *
 * It used to travel with `/task`'s directive, which told it to 「记下来」 — the
 * opposite of continuing. A shared directive for a command whose job is different
 * is worse than no directive, because the model follows the instruction it was
 * given: 「继续」 answered by creating new cards is a turn spent adding work instead
 * of resuming it.
 *
 * It also names BOTH surfaces. The old prompt read 「读一下任务清单里还没完成的事
 * 项」 — 「任务清单」 means the checklist here, so cards in 进行中 were never read,
 * and the answer was a resumption plan for strictly half of the outstanding work.
 */
const CONTINUE_DIRECTIVE = '（这是通过 /task-continue 发出的请求：续上还没做完的工作。'
  + '看板和清单两边都要看——卡上在「进行中」「待审核」的，清单里还没勾完的，都属于没做完。'
  + '把它们列出来，然后问我要从哪一条开始。不要替我挑，也不要新开活。）\n\n'

/**
 * `/task-status`: SAY WHAT THE STATE IS. Read only.
 *
 * Not `/task` with a different sentence: 「板子上现在什么情况」 is a question, and
 * the fastest way to answer a question badly is to hand it to a command whose
 * directive says 「真的把它处理掉」. The model then tidies, renames, or creates
 * something — and the person who asked for a number gets a diff.
 *
 * So this directive says explicitly: read, report, do not write. It also names the
 * DIMENSIONS rather than 「概况」, because 「概况」 is answered with prose that omits
 * the one thing the asker wanted.
 */
const STATUS_DIRECTIVE = '（这是通过 /task-status 发出的请求：报告现状，只读不写。'
  + '看板按栏说各有几张、哪些在跑、哪些卡在等审批或等回答、哪些排期着；清单说有哪几条还没勾完、哪几条到了日子。'
  + '说完数字就好，不要顺手整理、不要新建、不要改任何东西。）\n\n'

/**
 * `/task-cleanup`: TIDY UP, AND KEEP THE THREE DELETE COSTS APART.
 *
 * ── WHY IT COVERS BOTH SURFACES ────────────────────────────────────────────
 *
 * The report that asked for this command said 「和那个 task status 一样，反正他们各种
 * 斜杠指令都可以指任务看板和任务清单那边的」. That is the requirement, and it is
 * also the correct one: a mess does not respect the panel boundary. Cards pile up
 * in 已完成, checklist entries pile up past their date, and a cleanup that tidies
 * one document leaves the other exactly as untidy.
 *
 * ── THE THREE COSTS, WHICH THE MODEL MUST NOT BLUR ─────────────────────────
 *
 * This project has THREE different deletes and they are NOT interchangeable. A
 * directive that says 「清理一下」 and leaves the choice to the model invites the one
 * move that cannot be undone:
 *
 *  1. `item.delete` — GUARDED and REVERSIBLE. It writes a tombstone, so the row
 *     comes back with `item.restore`, intact. This is the default for a checklist
 *     row, and it is the only delete that should happen without asking.
 *  2. `item.purge` — IRREVERSIBLE. It throws away the tombstone's stored body as
 *     well. The row is gone for good.
 *  3. `task.delete` — IRREVERSIBLE. A card keeps no tombstone at all: its rounds,
 *     its sessions and its comments go with it.
 *
 * So the directive ORDERS them: delete checklist rows freely (recoverable), and
 * come back to ask before anything irreversible. Naming the three by their action
 * ids is safe here because `verify-action-coverage.mjs` holds this file against the
 * catalog — an id renamed in the catalog turns this file red instead of quietly
 * becoming a stale name in a directive the model reads.
 */
const CLEANUP_DIRECTIVE = '（这是通过 /task-cleanup 发出的请求：把看板和清单都收拾一下。两边都要看。'
  + '可以先删的是清单里那些已经没用的条目（item.delete，走墓碑，能恢复），删完告诉我删了什么。'
  + '**不可撤销的要先问我**：把清单条目彻底清掉（item.purge）会连正文一起扔掉，删一张卡（task.delete）会连它的轮次和会话一起带走——这两样在我同意之前一条都不要做，先把你的清单发给我看。）\n\n'

/**
 * Hand one sentence to a session's model.
 *
 * THE ONE PATH from this plugin's COMMANDS into a model. All four slash commands
 * call it, so they share one `followup`, one message shape and one failure story —
 * a second copy of these four lines is a second thing to keep in step, and the day
 * they drift is the day one of the paths quietly stops saying what it says. (The
 * checklist panel's 「问 AI」 is a separate path with a different job: it carries a
 * row's own text and starts or continues a card, so it lives in
 * `core/item-ask.ts` rather than being bent into this one.)
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
    return { kind: 'error', text: `这句话没能送进会话：${messageOf(error)}` }
  }
}

/** The four command definitions, ready to register. */
export function createTaskboardCommands(): readonly CommandDefinition[] {
  return [
    {
      name: 'task',
      description: '把这句话交给当前会话的模型，让它用看板或清单真的处理掉（它看得到这轮对话的上下文）',
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
      description: '续上没做完的工作：看板在跑的与清单未勾完的一起看，问你要从哪一条开始',
      recordInput: false,
      // An argument narrows a question that is about everything outstanding, so
      // it is accepted if typed but never asked for.
      handler: ({ agent, rawInput }) => {
        const said = rawInput.trim()
        return handOver(agent, said === '' ? '继续。' : `继续：${said}`, CONTINUE_DIRECTIVE)
      },
    },
    {
      name: 'task-status',
      description: '报告看板与清单的现状（只读，不整理也不新建）',
      recordInput: false,
      input: { hint: '可以留空；也可以点一句要重点看什么，例如：哪些卡在等我' },
      handler: ({ agent, rawInput }) => {
        const focus = rawInput.trim()
        return handOver(
          agent,
          focus === '' ? '现在什么情况？' : `现在什么情况？重点看：${focus}`,
          STATUS_DIRECTIVE,
        )
      },
    },
    {
      name: 'task-cleanup',
      description: '收拾看板与清单：能恢复的直接删，不可撤销的先问你',
      recordInput: false,
      input: { hint: '可以留空；也可以说清范围，例如：只收拾已完成那一栏' },
      handler: ({ agent, rawInput }) => {
        const scope = rawInput.trim()
        return handOver(
          agent,
          scope === '' ? '帮我收拾一下。' : `帮我收拾一下：${scope}`,
          CLEANUP_DIRECTIVE,
        )
      },
    },
  ]
}

/** Register all four, and return one disposer that takes them all off. */
export function registerTaskboardCommands(registry: CommandRegistrar): () => void {
  const disposers = createTaskboardCommands().map(definition => registry.register(definition))
  return () => { for (const dispose of disposers) dispose() }
}
