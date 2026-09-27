/**
 * Transition tests (src/core/task-transitions.ts): the semantics the interface
 * and the model must share, so that "the same thing" cannot come out two ways.
 *
 * Each transition is asked three questions — does the normal path work, does the
 * refusal path refuse WITH A REASON, and does a redundant write hand back the
 * very same object — because those are the three ways this kind of function
 * fails quietly: a semantic that only one caller gets, a `false` with nothing
 * behind it, and a stamp that churns every replica for a no-op.
 *
 * The last two describes are the module's constitution: it reads no clock, no
 * randomness and no store, and it does not import the controller. Both are
 * checked against the source rather than trusted, because a pure function that
 * quietly reads `Date.now()` is not pure — it is just untested until somebody
 * runs it twice.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  applyCommit,
  emptyBoardDoc,
  type BoardCommit,
} from '../src/core/board-doc.ts'
import {
  armSchedule,
  moveTaskToStatus,
  removeSessionFromTask,
  type TransitionResult,
} from '../src/core/task-transitions.ts'
import { createTask, type ExecutionRecord, type ScheduleRule, type TaskRecord } from '../src/core/tasks.ts'

const T0 = 1_700_000_000_000

/** A schedule with every key the record type requires PRESENT.
 *
 *  `withSchedule` always writes all of them, so the type demands the key even
 *  when its value is undefined — and a literal that forgets one is a TYPE
 *  error that no runtime test would ever catch. One builder, so no test has to
 *  remember which keys those are. */
function rule(patch: Partial<ScheduleRule> = {}): ScheduleRule {
  return {
    enabled: false,
    mode: 'cron',
    cron: '',
    runCount: 0,
    primed: true,
    nextRunAt: undefined,
    lastTriggeredAt: undefined,
    maxRuns: undefined,
    missedToleranceMs: undefined,
    ...patch,
  }
}

/** One card, with only what a test cares about overridden. */
function card(patch: Partial<TaskRecord> = {}): TaskRecord {
  return { ...createTask({ title: 'A', description: '', prompt: 'p' }, T0, 't-1'), ...patch }
}

/** Unwrap a transition, failing loudly rather than silently returning a row. */
function taskOf(result: TransitionResult): TaskRecord {
  if (!result.ok) throw new Error(`expected an applied transition, refused with: ${result.why}`)
  return result.task
}

/** One settled round of a session. */
function settledRound(id = 'e-1', sessionId = 's-1'): ExecutionRecord {
  return { id, sessionId, startedAt: T0, endedAt: T0 + 1, result: 'succeeded', error: undefined }
}

/** One round still in flight — an OPEN run is what "this card is busy" means. */
function openRound(id = 'e-1', sessionId = 's-1'): ExecutionRecord {
  return { id, sessionId, startedAt: T0, endedAt: undefined, result: undefined, error: undefined }
}

describe('moveTaskToStatus', () => {
  it('moves the card and appends to the status history', () => {
    const task = card()
    const next = taskOf(moveTaskToStatus(task, 'done', T0 + 10))
    expect(next.status).toBe('done')
    expect(next.statusHistory?.map(entry => entry.status)).toEqual(['todo', 'done'])
    expect(next.updatedAt).toBe(T0 + 10)
  })

  it('moving to done is a HARD STOP: schedule disarmed, every session rule off', () => {
    // The whole reason this module exists: the interface does this, and a model
    // that only set `status` would leave a finished card still running itself.
    const task = card({
      schedule: rule({ enabled: true, cron: '0 9 * * *', nextRunAt: T0 + 1, runCount: 3, maxRuns: 10 }),
      rules: [{
        id: 'r-1', sessionId: 's-1', instruction: 'go', cron: '0 8 * * *',
        trigger: 'cron', send: 'queue', enabled: true,
      }],
    })
    const next = taskOf(moveTaskToStatus(task, 'done', T0 + 10))
    expect(next.schedule?.enabled).toBe(false)
    // The configuration SURVIVES, so re-arming resumes the same rule.
    expect(next.schedule?.cron).toBe('0 9 * * *')
    expect(next.schedule?.maxRuns).toBe(10)
    expect(next.rules?.every(rule => !rule.enabled)).toBe(true)
  })

  it('leaving done is a REBIRTH: the spent budget goes back to zero, the rules stay off', () => {
    const task = card({
      status: 'done',
      schedule: rule({ cron: '0 9 * * *', runCount: 10, maxRuns: 10 }),
      rules: [{ id: 'r-1', sessionId: 's-1', instruction: 'go', cron: '', trigger: 'on-complete', send: 'queue', enabled: false }],
    })
    const next = taskOf(moveTaskToStatus(task, 'todo', T0 + 20))
    expect(next.schedule?.runCount).toBe(0)
    // A move must not quietly re-arm automation; that stays an explicit act.
    expect(next.schedule?.enabled).toBe(false)
    expect(next.rules?.[0]?.enabled).toBe(false)
  })

  it('does NOT judge the move — that question has its own homes', () => {
    // The migration is the migration: it moves whatever it is told to, exactly
    // as the interface's own path does. A guard buried in here would leave the
    // interface one verdict and the model another for one question. Whether a
    // person may move this card by hand is answered by the action catalog
    // (`task.move`'s status is fenced to MANUAL_STATUSES), by the interface's
    // own rendering of that same list, and by the engine's resolveCardDrop —
    // three needs, one shared constant, and deliberately no fourth expression.
    const task = card()
    const moved = taskOf(moveTaskToStatus(task, 'running', T0 + 10))
    expect(moved.status).toBe('running')
  })

  it('a redundant move is the SAME object (no stamp, no sync churn)', () => {
    const task = card()
    const result = moveTaskToStatus(task, 'todo', T0 + 10)
    expect(taskOf(result)).toBe(task)
    expect(result.ok && result.task.updatedAt).toBe(T0)
  })
})

describe('armSchedule', () => {
  it('arms a valid rule and stamps the next hop from the given instant', () => {
    const next = taskOf(armSchedule(card(), { enabled: true, cron: '0 9 * * *' }, T0 + 10))
    expect(next.schedule?.enabled).toBe(true)
    expect(next.schedule?.cron).toBe('0 9 * * *')
    // Deterministic because `now` is an argument: the same call lands the same instant.
    expect(next.schedule?.nextRunAt).toBe(taskOf(armSchedule(card(), { enabled: true, cron: '0 9 * * *' }, T0 + 10)).schedule?.nextRunAt)
  })

  it('disarming is ALWAYS allowed — that is what keeps a dead arm removable', () => {
    const task = card({ prompt: '', schedule: rule({ enabled: true, cron: '0 9 * * *' }) })
    const next = taskOf(armSchedule(task, { enabled: false }, T0 + 10))
    expect(next.schedule?.enabled).toBe(false)
  })

  it('refuses a DEAD ARM (no execution prompt) with a reason the model can act on', () => {
    const task = card({ prompt: '' })
    const result = armSchedule(task, { enabled: true, cron: '0 9 * * *' }, T0 + 10)
    expect(result.ok).toBe(false)
    if (result.ok) return
    // A refusal that only says "refused" leaves the model with nothing to fix.
    expect(result.why).toContain('执行 Prompt')
  })

  it('refuses an unparseable or empty cron, and keeps the stored one', () => {
    for (const cron of ['', 'not a cron', '0 9 * *']) {
      const result = armSchedule(card(), { enabled: true, cron }, T0 + 10)
      expect(result.ok, `cron "${cron}" should be refused`).toBe(false)
    }
  })

  it('chain mode does not consume the expression, and switching back keeps it', () => {
    const armed = taskOf(armSchedule(card(), { enabled: true, cron: '0 9 * * *' }, T0 + 10))
    const chained = taskOf(armSchedule(armed, { mode: 'chain' }, T0 + 20))
    expect(chained.schedule?.cron).toBe('0 9 * * *')
    expect(chained.schedule?.nextRunAt).toBeUndefined()
  })

  it('changing the run budget starts THAT budget again', () => {
    const armed = taskOf(armSchedule(card(), { enabled: false, cron: '0 9 * * *', maxRuns: 10 }, T0 + 10))
    expect(armed.schedule?.runCount).toBe(0)
    const spent = { ...armed, schedule: { ...armed.schedule!, runCount: 7 } }
    const resized = taskOf(armSchedule(spent, { maxRuns: 20 }, T0 + 20))
    expect(resized.schedule?.maxRuns).toBe(20)
    expect(resized.schedule?.runCount).toBe(0)
  })

  it('a write that changes nothing is the SAME object', () => {
    // A replica re-sending the rule it already synced must not re-stamp the
    // card: the next hop is recomputed from the SAME instant, so the resulting
    // row is identical and the whole commit collapses to a no-op.
    const armed = taskOf(armSchedule(card(), { enabled: true, cron: '0 9 * * *' }, T0 + 10))
    expect(taskOf(armSchedule(armed, { enabled: true, cron: '0 9 * * *' }, T0 + 10))).toBe(armed)
  })

  it('refuses a write on a card with no rule at all, because there is nothing to disarm', () => {
    // Today's behaviour, kept deliberately: the cron check comes first, so a
    // card that never had a rule cannot be "disarmed". Nothing is lost — there
    // was no rule to switch off — and inventing a second order here would give
    // the model an answer the interface cannot give.
    expect(armSchedule(card(), { enabled: false }, T0 + 10).ok).toBe(false)
  })
})

describe('removeSessionFromTask', () => {
  /** A card with one bound session, one hidden row of it, and a manual order. */
  function withSession(patch: Partial<TaskRecord> = {}): TaskRecord {
    return card({
      binds: [{ kind: 'session', sessionId: 's-1' }],
      hidden: { sessions: ['s-1'], executions: ['e-1'] },
      sessionsOrder: ['s-1', 's-2'],
      executions: [
        { id: 'e-1', sessionId: 's-1', startedAt: T0, endedAt: T0 + 1, result: 'succeeded', error: undefined },
        { id: 'e-2', sessionId: 's-2', startedAt: T0, endedAt: T0 + 1, result: 'succeeded', error: undefined },
      ],
      ...patch,
    })
  }

  it('really deletes the session\'s rounds, and remembers it can never come back', () => {
    const next = taskOf(removeSessionFromTask(withSession(), 's-1', T0 + 10, () => 'idle'))
    expect(next.executions.map(round => round.id)).toEqual(['e-2'])
    // The record is the reason a bound workspace can never derive it back.
    expect(next.removedSessions).toEqual(['s-1'])
    // The hide tray forgets a row that no longer exists…
    expect(next.hidden).toBeUndefined()
    // …and the manual order loses a slot that can never be refilled.
    expect(next.sessionsOrder).toEqual(['s-2'])
  })

  it('releases a binding that pointed ONLY at that session', () => {
    const next = taskOf(removeSessionFromTask(withSession(), 's-1', T0 + 10, () => 'idle'))
    expect(next.binds).toBeUndefined()
  })

  it('leaves a multi-source binding list alone — removal is recorded, not re-bound', () => {
    // Faithful to what the board does today: only a binding that pointed ONLY
    // at the removed session is released. With a second source the entry stays,
    // and that is harmless rather than sloppy — `removedSessions` is what every
    // derivation of "related sessions" subtracts, so a stale entry can never
    // bring the session back. Pinning it because the next reader will ask.
    const task = withSession({ binds: [{ kind: 'session', sessionId: 's-1' }, { kind: 'workspace', workspaceId: 'w-1' }] })
    const next = taskOf(removeSessionFromTask(task, 's-1', T0 + 10, () => 'idle'))
    expect(next.binds).toEqual([{ kind: 'session', sessionId: 's-1' }, { kind: 'workspace', workspaceId: 'w-1' }])
    expect(next.removedSessions).toEqual(['s-1'])
  })

  it('asks the reader about the row it PRODUCED, not the one it was handed', () => {
    // This is why the live state is a reader and not a value: the record half
    // can shrink the card's related-session set, so a verdict computed before
    // the call describes a card that no longer exists.
    const asked: TaskRecord[] = []
    removeSessionFromTask(withSession({ status: 'running' }), 's-1', T0 + 10, current => {
      asked.push(current)
      return 'idle'
    })
    expect(asked).toHaveLength(1)
    // The reader saw the card AFTER the bind and the rounds were gone.
    expect(asked[0]!.binds).toBeUndefined()
    expect(asked[0]!.executions.map(round => round.id)).toEqual(['e-2'])
  })

  it('leaves 进行中 in the same frame when the deletion swept the last running evidence', () => {
    const running = withSession({
      status: 'running',
      executions: [openRound('e-1', 's-1')],
    })
    const next = taskOf(removeSessionFromTask(running, 's-1', T0 + 10, () => 'idle'))
    // The open round that was holding the card is GONE and nothing is working,
    // so the card leaves in this same edit — the schedule is not a reason to
    // stay, because the very deletion removed what the schedule would explain.
    expect(next.status).not.toBe('running')
    // The column change went through the one funnel, so the row is stamped and
    // the history grew by exactly one entry.
    expect(next.updatedAt).toBe(T0 + 10)
    expect(next.statusHistory).toHaveLength(2)
  })

  it('stays in the column when something is still running (the reader says so)', () => {
    const running = withSession({ status: 'running', executions: [openRound('e-1', 's-1')] })
    const next = taskOf(removeSessionFromTask(running, 's-1', T0 + 10, () => 'running'))
    expect(next.status).toBe('running')
  })

  it('refuses a session that is not on this card, with a reason the model can act on', () => {
    const task = card({ executions: [settledRound('e-9', 's-9')] })
    const result = removeSessionFromTask(task, 's-1', T0 + 10, () => 'idle')
    expect(result.ok).toBe(false)
    if (result.ok) return
    // A silent ok:true reads as "deleted", and a model that believed it would
    // go on to write a receipt about work it never did. The interface caller
    // IGNORES a refusal (today it gets a `false` and does nothing), so one
    // function serves both consumers.
    expect(result.why).toContain('s-1')
    expect(result.why).toContain('taskboard_query')
    // The input row is untouched either way.
    expect(task.executions).toHaveLength(1)
  })
})

describe('the deletion this module deliberately does not own', () => {
  it('the tombstone outranks every stale copy — proven through the grammar that owns it', () => {
    // Deletion is not a transition, so this module has no delete function and
    // this test names none. What it pins is WHERE the law lives and that the
    // law holds: a delete at the row's own stamp takes the row out and lands a
    // tombstone one millisecond above the newest stamp the host ever saw, a
    // replica still holding the old copy cannot bring it back, and a genuinely
    // newer edit still can.
    const task = card({ updatedAt: 5_000 })
    const commit = (patch: Partial<BoardCommit> = {}): BoardCommit => ({
      clientId: 'c-1',
      tasks: [],
      deleted: [],
      cruise: { value: { enabled: false, limit: 5, schedule: [] }, at: 0 },
      schedulePresets: { value: [], at: 0 },
      runPresets: { value: { presets: [] }, at: 0 },
      ...patch,
    })
    const held = applyCommit(emptyBoardDoc(T0), commit({ tasks: [task] }), T0 + 1)
    const deleted = applyCommit(held, commit({ deleted: [{ id: 't-1', baseUpdatedAt: task.updatedAt }] }), T0 + 2)
    expect(deleted.tasks).toEqual([])
    expect(deleted.tombstones['t-1']?.at).toBe(task.updatedAt + 1)
    // The stale replica's copy changes nothing...
    const stale = applyCommit(deleted, commit({ tasks: [task] }), T0 + 3)
    expect(stale).toBe(deleted)
    // ...while a genuinely newer edit still revives the card.
    const revived = applyCommit(deleted, commit({ tasks: [{ ...task, updatedAt: task.updatedAt + 2 }] }), T0 + 4)
    expect(revived.tasks).toHaveLength(1)
    expect(revived.tombstones['t-1']).toBeUndefined()
  })
})

describe('the module is pure (source scan)', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/core/task-transitions.ts', import.meta.url)), 'utf8')

  /** The module's CODE with comments blanked out.
   *
   *  A gate that scans prose is a gate that fires the next time somebody
   *  rewords a comment — and a gate people learn to ignore is worse than no
   *  gate. This module's header SAYS there is no `Date.now()` in it, which is
   *  exactly the sentence a whole-file scan must not read as a violation.
   *  Strings are kept: a banned token inside a string is content, and code
   *  inside a template literal's `${}` is a known blind spot of a text scan. */
  function code(text: string): string {
    let out = ''
    let i = 0
    while (i < text.length) {
      const ch = text[i]!
      const next = text[i + 1]
      if (ch === '/' && next === '/') {
        while (i < text.length && text[i] !== '\n') i++
        continue
      }
      if (ch === '/' && next === '*') {
        i += 2
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
        i += 2
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        out += ch
        i++
        while (i < text.length) {
          const inner = text[i]!
          out += inner
          if (inner === '\\') { out += text[i + 1] ?? ''; i += 2; continue }
          i++
          if (inner === ch) break
        }
        continue
      }
      out += ch
      i++
    }
    return out
  }

  it('reads no clock and no randomness — a second call is the same answer', () => {
    const text = code(source)
    for (const banned of ['Date.now', 'new Date', 'Math.random', 'performance.now', 'crypto.getRandomValues']) {
      expect(text.includes(banned), `${banned} in a pure transition means the answer depends on when it ran`).toBe(false)
    }
  })

  it('imports no controller, no store and no engine — only the pure core', () => {
    // The seam is worthless if a caller can reach live state THROUGH it: the
    // point is that both the interface and the model get the same answer from
    // the same row, with nothing the host knows sneaking in.
    const imported = [...code(source).matchAll(/from\s+'(\.[^']+)'/g)].map(match => match[1]!)
    expect([...new Set(imported)].sort()).toEqual([
      './automation.ts', './schedule.ts', './task-live.ts', './tasks.ts',
    ])
    for (const forbidden of ['./controller.ts', './store.ts', './host-sync.ts', './execution.ts', './board-doc.ts']) {
      expect(imported, `a transition may not reach ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('never throws: a refusal is a value, because a tool must be able to read it', () => {
    // Every refusal path is an object literal; a `throw` in the code would turn
    // a "here is what to fix" into a stack trace.
    expect(code(source)).not.toMatch(/\bthrow\b/)
  })
})
