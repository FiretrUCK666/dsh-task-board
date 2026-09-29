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

describe('the two commands', () => {
  it('registers /task and /task-continue, neither recording its input', () => {
    const commands = createTaskboardCommands()
    expect(commands.map(c => c.name)).toEqual(['task', 'task-continue'])
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

  it('/task hands the person\'s own words to the session model, unedited', async () => {
    const box = agent()
    expect(await invoke(0, box, '  把刚才说的三件事记下来  ')).toEqual({ kind: 'success' })
    expect(box.handed).toHaveLength(1)
    expect(box.handed[0]?.content[0]?.text).toBe('把刚才说的三件事记下来')
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

  it('a blank /task ANSWERS with the usage line — and does not paint a failure', async () => {
    // This test used to PIN `kind: 'error'`, which is what the client paints
    // RED. So the most likely first move in a brand-new session — type `/task`
    // and press enter to see what it does — put a red card on the screen carrying
    // a perfectly good sentence of help. Nothing had failed; the colour said it
    // had, and a reader is told the command is broken.
    //
    // The host's own contract is what makes this more than a shade: 「a
    // thrown/aborted handler settles as `kind: 'error'`」. So `error` means the
    // command FAILED, and a usage hint is not a failure — it is the command doing
    // the one thing it can do with no argument.
    //
    // The words are unchanged, so nothing that reads the sentence is affected; only
    // the kind, and that is the whole point.
    const box = agent()
    const result = await invoke(0, box, '   ')
    expect(result.kind, 'a blank /task is answered, not failed — the reader is not shown red for asking').toBe('success')
    expect(box.handed, 'a blank /task must not guess and hand something over').toHaveLength(0)
    expect('text' in result && result.text).toContain('/task')
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

  it('a delivery failure is reported in words, not swallowed', async () => {
    const failing: CommandAgent = { followup() { throw new Error('会话已关闭') } }
    const result = await invoke(0, failing, '记一下')
    expect(result).toMatchObject({ kind: 'error' })
    if (result.kind === 'error') expect(result.text).toContain('会话已关闭')
  })

  it('one disposer takes both commands off', () => {
    const box = registry()
    const dispose = registerTaskboardCommands(box)
    expect([...box.registered.keys()]).toEqual(['task', 'task-continue'])
    dispose()
    expect(box.registered.size).toBe(0)
  })
})
