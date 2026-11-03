/**
 * Slash-command contract tests (src/host/agent/commands.ts).
 *
 * A command here is a door, not a pipeline: the only things worth pinning are
 * that it hands the person's own words to the session's model, that it does
 * not record them a second time, and that a blank `/task` says so instead of
 * making the model guess.
 */
import { describe, expect, it } from 'vitest'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { createTaskboardCommands, registerTaskboardCommands, type CommandAgent, type CommandRegistrar } from '../src/host/agent/commands.ts'
/** The invocation's agent, taken FROM the host's own contract rather than a
 *  second import: one derivation, so a host change moves both at once. */
type HostAgent = Parameters<CommandDefinition['handler']>[0]['agent']

/** A registry that keeps every definition and can run a handler. */
function registry(): CommandRegistrar & { registered: Map<string, CommandDefinition> } {
  // The face is a Map keyed by name; what it STORES is the host's own
  // `CommandDefinition`, so a test can no longer assert against a contract the
  // plugin invented and the host never agreed to.
  const registered = new Map<string, CommandDefinition>()
  return {
    registered,
    register(definition: CommandDefinition) {
      registered.set(definition.name, definition)
      return () => registered.delete(definition.name)
    },
  }
}

/** An agent that records what it was handed, and can REFUSE to take it.
 *  A hard-coded `return` cannot refuse, so every claim about a failed hand-over
 *  was untestable while this face could not say no. */
function agent(): CommandAgent & {
  handed: { content: readonly { type: string; text?: string }[] }[]
  throwOnFollowup: boolean
} {
  const handed: { content: readonly { type: string; text?: string }[] }[] = []
  return {
    handed,
    throwOnFollowup: false,
    followup(message) {
      if (this.throwOnFollowup) throw new Error('这个会话还没有可以回答的模型')
      handed.push(message as { content: readonly { type: string; text?: string }[] })
    },
  }
}

describe('the four commands', () => {
  it('registers all four, none of them recording its input', () => {
    const commands = createTaskboardCommands()
    expect(commands.map(c => c.name)).toEqual(['task', 'task-continue', 'task-status', 'task-cleanup'])
    for (const command of commands) {
      // The sentence is already a message in the session; recording it again
      // would put the same words in the log twice.
      expect(command.recordInput).toBe(false)
      expect(command.description).not.toBe('')
    }
  })

  // A handler takes the host's OWN invocation, whose `agent` is the real
  // `Agent`. The double below is cast rather than faked field by field, and
  // the cast is the honest shape of the test: the plugin touches exactly one
  // method on that object, and spelling the other ten out would be a second,
  // drifting copy of the host's interface. The COMMAND contract around it is
  // the real one, so a wrong return type cannot compile any more.
  const invoke = async (index: number, agent: CommandAgent, rawInput: string) =>
    await createTaskboardCommands()[index]!.handler({ agent: agent as unknown as HostAgent, rawInput } as never)

  it('/task hands the person\'s own words to the session model, unedited, behind the board directive', async () => {
    const box = agent()
    expect(await invoke(0, box, '  把刚才说的三件事记下来  ')).toEqual({ kind: 'success' })
    expect(box.handed).toHaveLength(1)
    const sent = box.handed[0]?.content[0]?.text ?? ''
    // The person's words arrive EXACTLY as typed — the directive is prepended,
    // never woven in, so the model cannot misread which part is theirs.
    expect(sent.endsWith('把刚才说的三件事记下来')).toBe(true)
    // ...and they arrive with the one instruction the command promises: use the
    // tools. Without it the command was literally indistinguishable from plain
    // chat, and measured against a real board it left no card at all.
    expect(sent).toContain('/task')
    expect(sent).toContain('工具')
  })

  /**
   * `/task` NO LONGER SAYS 「记到看板上」.
   *
   * It used to, and that directive was wrong for the commonest case. 「记一下明天
   * 买牛奶」 is a checklist entry; a card is a thing that gets EXECUTED, so building
   * one for a shopping reminder fills the board with reminders waiting to run —
   * the plugin creating the mess the person asked it to absorb.
   *
   * The command cannot decide the surface, and should not: that is a judgment about
   * intent, and the manual is where it is taught. So the directive names the JOB
   * and both surfaces, and says to ask when the intent is unclear.
   */
  it('/task names both surfaces and does not assume the board', async () => {
    const box = agent()
    await invoke(0, box, '记一下明天买牛奶')
    const sent = box.handed[0]?.content[0]?.text ?? ''
    // Both documents are named: a directive naming one of them forgets the other
    // for every request that belonged to it.
    expect(sent).toContain('看板')
    expect(sent).toContain('清单')
    // And the judgment is handed over rather than pre-empted.
    expect(sent).toContain('判断')
    // The old, single-surface phrasing is gone — not merely supplemented.
    expect(sent).not.toContain('请用看板的工具把这件事真的记下来')
  })

  it('the directive does not try to be a workflow', async () => {
    // It names WHAT to do (record it on the board), never HOW — no tool name, no
    // field list, no order. The injected prompt teaches the steps; a command that
    // also scripted them would be a second set of rules to keep in step.
    const box = agent()
    await invoke(0, box, '记一下')
    const sent = box.handed[0]?.content[0]?.text ?? ''
    expect(sent).not.toContain('task.create')
    expect(sent).not.toContain('taskboard_execute')
  })

  it('/task DECLARES input, so clicking it in the menu claims instead of executing', () => {
    // THE CLICK CONTRACT, and it is not cosmetic. The host's dispatcher keeps two
    // behaviours behind this one field — its own comment names them: 「host input
    // → claim; host bare → detached execute」.
    //
    //   input declared  -> picking it leaves `/task ` in the composer and waits
    //                      for the sentence; the handler does NOT run
    //   input absent    -> picking it runs the command immediately with no
    //                      argument, i.e. the person who only wanted to USE the
    //                      command instead gets a usage message
    //
    // This command shipped without `input`, so a click behaved like a submit.
    // The report was 「我点一下，它什么都没运行，然后弹出一段东西，很奇怪」 — and
    // that is exactly what the absent field produces.
    const task = createTaskboardCommands()[0]!
    expect(task.input, 'a command that needs a sentence must declare input').toBeDefined()
    expect(task.input?.hint.trim(), 'the hint is what tells the reader to keep typing').not.toBe('')
  })

  it('/task-continue takes no argument, so it must NOT declare input', () => {
    // The other half of the same rule. `/task-continue` answers a question about
    // what is outstanding and by design carries no argument — declaring `input`
    // would claim the composer and wait for words that the command would ignore.
    const cont = createTaskboardCommands()[1]!
    expect(cont.input, 'continue asks nothing, so it claims nothing').toBeUndefined()
  })

  it('success carries no text: the model answers in the conversation, not here', async () => {
    // A text here would put a second, weaker rendering of the same turn in
    // front of the person, and the command owns no richer domain event.
    const result = await invoke(0, agent(), '记一下')
    expect(result).toEqual({ kind: 'success' })
    expect('text' in result).toBe(false)
  })

  it('a real user message, minted by the host\'s own factory', async () => {
    const box = agent()
    await invoke(0, box, '记一下')
    const message = box.handed[0] as unknown as { role: string; id: string; source: { kind: string } }
    // An id exists and the role/source are the host's own — a hand-rolled
    // message would have neither, and the host's own checks would skip it.
    expect(message.role).toBe('user')
    expect(message.source.kind).toBe('user')
    expect(typeof message.id).toBe('string')
    expect(message.id.length).toBeGreaterThan(0)
  })

  it('a blank /task says what to do in ONE line — and does not paint a failure', async () => {
    // `kind: 'error'` is what the client paints RED, so a blank submit must stay
    // `success`: nothing failed, the person just had not typed the sentence yet.
    //
    // The OTHER half of this is the length. This branch used to answer with a
    // three-step tutorial about building, configuring and running a card — and
    // that teaching already lives in the injected prompt, where it reaches the
    // model every turn. Repeating it on a blank submit spent the reader's
    // attention on the screen where they were least stuck.
    const box = agent()
    const result = await invoke(0, box, '   ')
    expect(result.kind, 'a blank /task is answered, not failed — the reader is not shown red for asking').toBe('success')
    expect(box.handed, 'a blank /task must not guess and hand something over').toHaveLength(0)
    const text = 'text' in result ? result.text ?? '' : ''
    expect(text).toContain('/task')
    // One line: no paragraph, no second sentence of tutorial.
    expect(text, 'a blank submit is answered in one line, not a paragraph').not.toContain('\n')
    expect(text.length, 'the hint is a sentence, not a manual').toBeLessThan(120)
    // The three-step teaching belongs to the prompt; it must not be duplicated here.
    expect(text).not.toContain('task.create')
    expect(text).not.toContain('session.create')
  })

  it('a REAL failure still paints as a failure', async () => {
    // The other half, and the reason the first one is not "make everything
    // success": a sentence that genuinely cannot be handed over must keep
    // saying so in the failure colour. A hint and a failure are different facts
    // and the gate has to tell them apart or it has stopped reading.
    const box = agent()
    box.throwOnFollowup = true
    const result = await invoke(0, box, '记一下')
    expect(result.kind, 'a hand-over that failed is still a failure').toBe('error')
  })

  it('/task-continue asks the model to list what is outstanding and ask, not to pick', async () => {
    const box = agent()
    expect(await invoke(1, box, '')).toEqual({ kind: 'success' })
    expect(box.handed[0]?.content[0]?.text).toContain('从哪一条开始')
  })

  /**
   * EACH COMMAND CARRIES ITS OWN JOB, because a shared directive lied.
   *
   * All four used to travel with `/task`'s sentence — 「请用看板的工具把这件事真的
   * 记下来」 — which is right for `/task` and wrong for the rest: 「继续」 is not
   * 「记下来」, 「现在什么情况」 is not a write at all, and 「清理一下」 that begins by
   * creating cards has made the mess bigger. A directive naming the wrong job is
   * worse than none, because the model follows it.
   */
  it('/task-continue says both surfaces, not just the checklist', async () => {
    // The old prompt read 「读一下任务清单里还没完成的事项」 — 「任务清单」 is the
    // checklist, so cards sitting in 进行中 were never read, and the answer was a
    // resumption plan for strictly half of what was outstanding.
    const box = agent()
    await invoke(1, box, '')
    const sent = box.handed[0]?.content[0]?.text ?? ''
    expect(sent).toContain('看板')
    expect(sent).toContain('清单')
    // And it must not have inherited the writing directive.
    expect(sent).not.toContain('真的把它处理掉')
  })

  it('/task-status is READ ONLY, and says so before the model can tidy anything', async () => {
    // 「板子上现在什么情况」 is a question. Handing it to a command whose directive
    // says 「真的把它处理掉」 gets the asker a diff instead of a number.
    const box = agent()
    await invoke(2, box, '')
    const sent = box.handed[0]?.content[0]?.text ?? ''
    expect(sent).toContain('只读不写')
    expect(sent).toContain('不要新建')
    // It names BOTH surfaces, which is the same requirement cleanup has.
    expect(sent).toContain('看板')
    expect(sent).toContain('清单')
  })

  it('/task-cleanup keeps the three delete costs apart, and asks before the irreversible two', async () => {
    // THREE different deletes, and they are not interchangeable:
    //   item.delete  — tombstone, comes back with item.restore. Safe by default.
    //   item.purge   — throws the tombstone's body away. Irreversible.
    //   task.delete  — a card keeps no tombstone; rounds and sessions go too.
    // A directive that says 「清理一下」 and leaves the choice invites the one move
    // that cannot be undone.
    const box = agent()
    await invoke(3, box, '')
    const sent = box.handed[0]?.content[0]?.text ?? ''
    // The recoverable one is authorised outright.
    expect(sent).toContain('item.delete')
    expect(sent).toContain('能恢复')
    // The two irreversible ones are named AND gated behind a question.
    expect(sent).toContain('item.purge')
    expect(sent).toContain('task.delete')
    expect(sent).toContain('先问我')
    // Both surfaces: a mess does not respect the panel boundary.
    expect(sent).toContain('看板')
    expect(sent).toContain('清单')
  })

  it('accepts a scope argument without requiring one', async () => {
    // 「只收拾已完成那一栏」 narrows the work; a blank submit means 「全部」. Neither
    // is an error, which is why these two declare `input` as a hint rather than a
    // requirement.
    const blank = agent()
    expect(await invoke(3, blank, '')).toEqual({ kind: 'success' })
    expect(blank.handed[0]?.content[0]?.text).toContain('帮我收拾')
    const scoped = agent()
    expect(await invoke(3, scoped, '只收拾已完成那一栏')).toEqual({ kind: 'success' })
    expect(scoped.handed[0]?.content[0]?.text).toContain('只收拾已完成那一栏')
  })

  it('a delivery failure is reported in words, not swallowed', async () => {
    const failing: CommandAgent = { followup() { throw new Error('会话已关闭') } }
    const result = await invoke(0, failing, '记一下')
    expect(result).toMatchObject({ kind: 'error' })
    if (result.kind === 'error') expect(result.text).toContain('会话已关闭')
  })

  it('one disposer takes all four commands off', () => {
    const box = registry()
    const dispose = registerTaskboardCommands(box)
    expect([...box.registered.keys()]).toEqual(['task', 'task-continue', 'task-status', 'task-cleanup'])
    dispose()
    expect(box.registered.size).toBe(0)
  })
})
