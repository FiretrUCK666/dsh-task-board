import { describe, expect, it } from 'vitest'
import { tipFromApi } from '../src/host/update-route.ts'

describe('the tip over the live API host', () => {
  it('answers with a sha, or honestly answers nothing', async () => {
    const tip = await tipFromApi('FiretrUCK666/dsh-task-board')
    console.log('LIVE_TIP ' + (tip === undefined ? 'undefined' : tip.head.slice(0, 12) + ' via ' + tip.via))
    if (tip !== undefined) {
      expect(tip.via).toBe('api')
      expect(tip.head).toMatch(/^[0-9a-f]{7,64}$/i)
    }
  }, 20_000)
})
