/**
 * Batch run selection (client/board/batch-run.ts): executable selected cards
 * in board order; the launch point owns everything else.
 */
import { describe, expect, it } from 'vitest'
import { runnableIds } from '../src/client/board/batch-run.ts'
import { createTask } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

describe('runnableIds', () => {
  it('keeps executable selected cards in board order, drops the rest', () => {
    const tasks = [
      createTask({ title: 'a', description: '', prompt: 'run me' }, NOW, 'a'),
      createTask({ title: 'b', description: '', prompt: '' }, NOW, 'b'),
      createTask({ title: 'c', description: '', prompt: 'run me too' }, NOW, 'c'),
    ]
    // Blank-prompt cards are inert (the execution gate) — never fired.
    expect(runnableIds(tasks, ['a', 'b', 'c'])).toEqual(['a', 'c'])
    // Unselected cards never fire, even when executable.
    expect(runnableIds(tasks, ['c'])).toEqual(['c'])
    expect(runnableIds(tasks, [])).toEqual([])
    expect(runnableIds(tasks, ['ghost'])).toEqual([])
  })
})
