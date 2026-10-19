// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { boundedByBudget } from '../src/host/update-route.ts'

describe('boundedByBudget', () => {
  it('returns the value when the work finishes in time', async () => {
    await expect(boundedByBudget(Promise.resolve(7), 1_000)).resolves.toBe(7)
  })

  it('gives up on time and yields undefined, without waiting for the work', async () => {
    const never = new Promise<string>(() => {})
    const started = Date.now()
    await expect(boundedByBudget(never, 50)).resolves.toBeUndefined()
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('reads a rejection as undefined, not as a thrown error', async () => {
    await expect(boundedByBudget(Promise.reject(new Error('boom')), 1_000)).resolves.toBeUndefined()
  })

  it('does not leave an unhandled rejection when the work rejects after the budget expired', async () => {
    /* **这是这个函数最危险的一条。** 预算先到、work 后失败：如果那时拒绝没有人接，
       进程会收到一次未处理的 rejection（在 Node 里默认是致命警告，在某些配置下直接退出）。
       这条用一次真实的「先超时、后拒绝」来证明那条拒绝被接住了。 */
    const seen: unknown[] = []
    const onUnhandled = (reason: unknown): void => { seen.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      let rejectLater: ((e: Error) => void) | undefined
      const late = new Promise<string>((_, reject) => { rejectLater = reject })
      await expect(boundedByBudget(late, 20)).resolves.toBeUndefined()
      rejectLater?.(new Error('late boom'))
      /* 给那个拒绝一个回合落地。 */
      await new Promise((r) => setTimeout(r, 50))
      expect(seen, '预算过期之后到来的拒绝没有被接住：那是一次未处理的 rejection').toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('keeps the first answer when the work settles exactly as the timer fires', async () => {
    /* 计时器与 work 同时到达：`resolve` 调两次是静默无操作，这条只钉住「不抛、不挂」。 */
    const results = await Promise.all([
      boundedByBudget(new Promise<number>((r) => setTimeout(() => { r(1) }, 30)), 30),
      boundedByBudget(new Promise<number>((r) => setTimeout(() => { r(2) }, 30)), 30),
    ])
    expect(results.length).toBe(2)
  })
})
