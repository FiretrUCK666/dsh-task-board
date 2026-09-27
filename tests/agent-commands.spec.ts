/**
 * Slash-command contract tests (src/host/agent/commands.ts).
 *
 * A command here is a door, not a pipeline: the only things worth pinning are
 * that it hands the person's own words to the session's model, that it does
 * not record them a second time, and that a blank `/task` says so instead of
 * making the model guess.
 */
import { describe, expect, it } from 'vitest'
import { createTaskboardCommands, registerTaskboardCommands, type CommandAgent, type CommandRegistry } from '../src/host/agent/commands.ts'

/** A registry that keeps every definition and can run a handler. */
function registry(): CommandRegistry & { registered: Map<string, Parameters<CommandRegistry['register']>[0]> } {
  const registered = new Map<string, Parameters<CommandRegistry['register']>[0]>()
  return {
    registered,
    register(definition) {
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

  it('/task hands the person\'s own words to the session model, unedited', () => {
    const box = agent()
    const result = createTaskboardCommands()[0]!.handler({ agent: box, rawInput: '  把刚才说的三件事记下来  ' })
    expect(result).toEqual({ ok: true })
    expect(box.handed).toHaveLength(1)
    expect(box.handed[0]?.content[0]?.text).toBe('把刚才说的三件事记下来')
  })

  it('a real user message, minted by the host\'s own factory', () => {
    const box = agent()
    createTaskboardCommands()[0]!.handler({ agent: box, rawInput: '记一下' })
    const message = box.handed[0] as unknown as { role: string; id: string; source: { kind: string } }
    // An id exists and the role/source are the host's own — a hand-rolled
    // message would have neither, and the host's own checks would skip it.
    expect(message.role).toBe('user')
    expect(message.source.kind).toBe('user')
    expect(typeof message.id).toBe('string')
    expect(message.id.length).toBeGreaterThan(0)
  })

  it('a blank /task refuses with the usage line instead of guessing', () => {
    const box = agent()
    const result = createTaskboardCommands()[0]!.handler({ agent: box, rawInput: '   ' })
    expect(result.ok).toBe(false)
    expect(box.handed).toHaveLength(0)
    if (result.ok === false) expect(result.error.message).toContain('/task')
  })

  it('/task-continue asks the model to list what is outstanding and ask, not to pick', () => {
    const box = agent()
    expect(createTaskboardCommands()[1]!.handler({ agent: box, rawInput: '' })).toEqual({ ok: true })
    expect(box.handed[0]?.content[0]?.text).toContain('从哪一条开始')
  })

  it('a delivery failure is reported in words, not swallowed', () => {
    const failing: CommandAgent = { followup() { throw new Error('会话已关闭') } }
    const result = createTaskboardCommands()[0]!.handler({ agent: failing, rawInput: '记一下' })
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.error.message).toContain('会话已关闭')
  })

  it('one disposer takes both commands off', () => {
    const box = registry()
    const dispose = registerTaskboardCommands(box)
    expect([...box.registered.keys()]).toEqual(['task', 'task-continue'])
    dispose()
    expect(box.registered.size).toBe(0)
  })
})
