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

/** An agent that records what it was handed. */
function agent(): CommandAgent & { handed: { content: readonly { type: string; text?: string }[] }[] } {
  const handed: { content: readonly { type: string; text?: string }[] }[] = []
  return { handed, followup(message) { handed.push(message as { content: readonly { type: string; text?: string }[] }) } }
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

  it('a blank /task refuses with the usage line instead of guessing', async () => {
    const box = agent()
    const result = await invoke(0, box, '   ')
    expect(result).toMatchObject({ kind: 'error' })
    expect(box.handed).toHaveLength(0)
    if (result.kind === 'error') expect(result.text).toContain('/task')
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
