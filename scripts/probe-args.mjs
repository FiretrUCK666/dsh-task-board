#!/usr/bin/env node
/**
 * 自测开关的**唯一读法**：拼错了要红，不能静默变成一次正常跑。
 *
 * ── 为什么这必须是共享的，而不是每个门禁各写一遍 ────────────────────────────
 *
 * 每个门禁都声称「自测通过 = 门禁是活的」。而这句话只在**拼对**时成立：
 *
 *   node scripts/verify-pinned-surface.mjs . --probe-typo
 *   → OK 自测：自带底的头放行（不误伤）。   exit 0
 *
 * `includes()` 对着一串不存在的字样回答 false，于是脚本走进正常分支、跑完全部
 * 检查、打印 OK、退出 0——它验的是一条**没人要求它验**的规矩，而调用方以为它验了
 * 探针。这不是「检查太严」，是「自测根本没发生，而输出看起来一样」。
 *
 * 所以开关的解析必须只有一处：认识的名字在这里列出，遇到 `--probe-*` 但不在名单上
 * 就报错退出。加一个探针时调用方顺手把它写进名单，**忘不了**——因为它同时也是
 * `known` 的第二个消费者（`pnpm verify` 要逐个调用它们）。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────────
 *
 *   import { probeOf } from './probe-args.mjs'
 *   const probe = probeOf(['--probe-missing', '--probe-present'])
 *   // probe === '--probe-missing' | '--probe-present' | undefined
 *   // 拼错 → 打印可用名单并以 1 退出（不是 0）
 *
 * 这个名字不叫 `verify-` 开头，所以 `verify-design-sync` 的反向检查不会把它当成
 * 一个门禁（它没有门禁的职责，只解析参数）。
 */

/**
 * 读出自测开关，拼错即失败。
 * @param known - 这个脚本认识的全部 `--probe-*` 名字。
 * @param argv - 参数表（默认 `process.argv`），自测时可注入。
 * @returns 命中的那个开关名，没有则 `undefined`。
 */
export function probeOf(known, argv = process.argv) {
  const seen = argv.filter((arg) => arg.startsWith('--probe'))
  if (seen.length === 0) return undefined
  for (const arg of seen) {
    if (!known.includes(arg)) {
      console.error(`FAIL 未知自测项 ${arg}`)
      console.error(`  这个脚本认识：${known.join(' / ')}`)
      console.error('  拼错的开关不会静默通过——否则「自测 OK」证明不了任何事。')
      process.exit(1)
    }
  }
  /* 一次只跑一个探针：两个一起给时，第二个会被当成普通参数，于是输出讲的是第一个
     的事——那又是一次「看起来验了」。 */
  if (seen.length > 1) {
    console.error(`FAIL 一次只能跑一个自测项，给的是：${seen.join(' ')}`)
    process.exit(1)
  }
  return seen[0]
}
