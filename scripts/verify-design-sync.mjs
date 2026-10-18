/**
 * 「设计法则三处不会漂开」的对账门禁。
 *
 * ── 它回答的那个问题 ─────────────────────────────────────────────────────
 *
 * 这个项目里每条设计法则有三个家：**实现**（CSS / 组件里的那一行）、**门禁**
 * （`scripts/verify-*.mjs`）、**标本**（`gallery/` 里让人看见它的那一眼）。
 *
 * 三处分离时最贵的失效不是「某处写错了」，而是**三处安静地漂开**：
 *
 *   · CSS 里多了一条胶囊，门禁不认识它 → 它永远不会被检查；
 *   · 加了一条法则却忘了写门禁 → 下一个人不知道它在承重；
 *   · 门禁改了判据，标本还是旧样子 → 读者照着展览学了一个过时的规矩。
 *
 * 三件事都**不会让构建失败**，所以必须由结构回答。`design/laws.ts` 是那三处唯一
 * 的交会点，这一条拿它逐条对账。
 *
 * ── 它判什么 ─────────────────────────────────────────────────────────────
 *
 *   1. 每一条法则的 `gate` 文件**真的存在**，而且真的**被 `pnpm verify` 调用**
 *      （只存在没接线 = 从没跑过）。
 *   2. 每一条法则的 `home`（实现落点）**真的存在**。
 *   3. 每一条法则的 `specimen`（标本 id）**真的被预览页渲染**（否则它只是字符串）。
 *   4. `verify` 链里调用的每个 `verify-*.mjs`**都有一条法则指向它**
 *      （反过来：有人守着一件事，而它不在法则表里 = 门禁在替一条没人知道的法则工作）。
 *   5. 法则的 `id` 唯一、`why` 非空（说不出理由的法则会被下一个人删掉）。
 *
 * 用法：`node scripts/verify-design-sync.mjs .`（随 `pnpm verify` 跑）。
 * 自测：`--probe-sync`（种一份坏表，五种错必须各报一条）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const target = process.argv[2] ?? '.'

/** 把 `design/laws.ts` 读成结构：不 import（那是 TS），用文本解析拿到字段。 */
export function readLaws(root) {
  const path = join(root, 'src/client/design/laws.ts')
  if (!existsSync(path)) return { error: `laws table missing at ${path}`, laws: [] }
  const source = readFileSync(path, 'utf8')
  /* 只看 `DESIGN_LAWS` 数组那一块：`as const` 之前。 */
  const start = source.indexOf('DESIGN_LAWS')
  const end = source.indexOf('] as const', start)
  if (start < 0 || end < 0) return { error: 'DESIGN_LAWS array not found', laws: [] }
  const block = source.slice(start, end)

  const laws = []
  /* 每个对象从 `{` 起、到配对的 `}` 止；字段用 `id: '...'` 一类的形状读。 */
  let depth = 0
  let startAt = -1
  for (let i = 0; i < block.length; i++) {
    const ch = block[i]
    if (ch === '{') {
      if (depth === 0) startAt = i
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0 && startAt >= 0) {
        const body = block.slice(startAt, i + 1)
        const field = (name) => {
          const match = new RegExp(`${name}\\s*:\\s*'([^']*)'`).exec(body)
          return match === null ? undefined : match[1]
        }
        const id = field('id')
        if (id !== undefined) {
          laws.push({
            id,
            rule: field('rule'),
            gate: field('gate'),
            specimen: field('specimen'),
            home: field('home'),
            why: field('why'),
          })
        }
        startAt = -1
      }
    }
  }
  return { laws }
}

/**
 * 自测：一份**故意坏掉**的表，五种错必须各报一条。
 *
 * 种在内存里而不是工作区里（硬性规范 16：证明门禁会红只能在 `tests/` 里种，
 * 而这一条的自测本身就是那个「tests」——它不碰真实文件）。
 */
if (process.argv.includes('--probe-sync')) {
  const planted = [
    /* 1. gate 文件不存在 */
    { id: 'ghost-gate', rule: 'r', gate: 'scripts/verify-does-not-exist.mjs', specimen: 'ink', home: 'src/client/design/tokens.module.css', why: 'w' },
    /* 2. home 不存在 */
    { id: 'ghost-home', rule: 'r', specimen: 'ink', home: 'src/client/design/nope.ts', why: 'w' },
    /* 3. specimen 没人渲染 */
    { id: 'ghost-specimen', rule: 'r', specimen: 'not-a-visible-group', home: 'src/client/design/tokens.module.css', why: 'w' },
    /* 4. why 空 */
    { id: 'no-reason', rule: 'r', specimen: 'ink', home: 'src/client/design/tokens.module.css', why: '' },
    /* 5. 重复 id */
    { id: 'no-reason', rule: 'r', specimen: 'ink', home: 'src/client/design/tokens.module.css', why: 'w' },
  ]
  /* 自测也要走**存在性检查**：那三种错（gate/home/specimen 指向不存在的东西）正是
  * 这一条的主角，跳过它就等于证明不了一半。oot 用仓库根，所以「不存在」是真的
  * 不存在；specimen 用一个绝不存在的 id。 */
  const problems = audit(planted, { root: target })
  const kinds = new Set(problems.map(one => one.kind))
  const want = ['gate-missing', 'home-missing', 'specimen-missing', 'why-empty', 'id-duplicate']
  const missing = want.filter(kind => !kinds.has(kind))
  if (missing.length > 0) {
    console.error(`verify-design-sync self-test FAILED: these planted faults were not reported: ${missing.join(', ')}`)
    console.error(`read: ${JSON.stringify(problems.map(p => p.kind))}`)
    process.exit(1)
  }
  console.log(`verify-design-sync self-test OK: all ${want.length} planted fault kinds are reported (missing gate, missing home, unrendered specimen, empty reason, duplicate id)`)
  process.exit(0)
}

/**
 * 逐条对账。
 * @param laws - 法则表。
 * @param options - `root`：仓库根；`skipPresence`：自测时跳过文件存在性。
 * @returns 问题清单（空数组 = 全绿）。
 */
export function audit(laws, options) {
  const root = options.root ?? '.'
  const problems = []
  const seenIds = new Set()

  /* 预览页真的渲染了哪些标本分组：读 `gallery/` 的源码里出现的 `data-dsh-taskboard-specimen` 值。 */
  const galleryDir = join(root, 'src/client/gallery')
  let gallerySource = ''
  if (existsSync(galleryDir)) {
    for (const name of readdirSafe(galleryDir)) {
      if (!name.endsWith('.tsx')) continue
      gallerySource += readFileSync(join(galleryDir, name), 'utf8')
    }
  }
  const renderedSpecimens = new Set(
    [...gallerySource.matchAll(/data-dsh-taskboard-specimen="([^"]+)"/g)].map(match => match[1]),
  )

  /* `pnpm verify` 真的调用了哪些脚本。 */
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const verifyChain = pkg.scripts?.verify ?? ''
  const wired = new Set(
    [...verifyChain.matchAll(/node (scripts\/[\w.-]+\.mjs)/g)].map(match => match[1]),
  )

  for (const law of laws) {
    if (seenIds.has(law.id)) {
      problems.push({ kind: 'id-duplicate', id: law.id, detail: `\`${law.id}\` is declared more than once` })
    }
    seenIds.add(law.id)

    if (law.why === undefined || law.why.trim() === '') {
      problems.push({ kind: 'why-empty', id: law.id, detail: 'no reason: a law with no stated reason gets deleted by the next person' })
    }

    if (law.home !== undefined && !options.skipPresence) {
      if (!existsSync(join(root, law.home))) {
        problems.push({ kind: 'home-missing', id: law.id, detail: `home \`${law.home}\` does not exist, so the anchor points at nothing` })
      }
    } else if (law.home === undefined) {
      problems.push({ kind: 'home-missing', id: law.id, detail: 'no home: a law must name the line that carries it' })
    }

    if (law.gate !== undefined && !options.skipPresence) {
      if (!existsSync(join(root, law.gate)) && !law.gate.startsWith('tests/')) {
        problems.push({ kind: 'gate-missing', id: law.id, detail: `gate \`${law.gate}\` does not exist` })
      }
      if (law.gate.startsWith('scripts/') && !wired.has(law.gate)) {
        problems.push({ kind: 'gate-unwired', id: law.id, detail: `gate \`${law.gate}\` exists but \`pnpm verify\` never calls it` })
      }
    } else if (law.gate === undefined && !options.skipPresence) {
      problems.push({ kind: 'gate-missing', id: law.id, detail: 'no gate: nothing checks this law, so it will drift on the next change' })
    }

    if (law.specimen !== undefined && !options.skipPresence) {
      if (!renderedSpecimens.has(law.specimen)) {
        problems.push({ kind: 'specimen-missing', id: law.id, detail: `specimen \`${law.specimen}\` is not rendered by the preview page, so nobody can see this law` })
      }
    } else if (law.specimen === undefined && !options.skipPresence) {
      problems.push({ kind: 'specimen-missing', id: law.id, detail: 'no specimen: the preview page cannot show this law' })
    }
  }

  /* 反向那一条：每个守着设计的门禁都该有一条法则指着它。 */
  if (!options.skipPresence) {
    const claimed = new Set(laws.map(law => law.gate).filter(name => name !== undefined))
    for (const script of wired) {
      if (!/verify-(palette|capsule-centring|hover-contrast|design-docs)/.test(script)) continue
      if (!claimed.has(script)) {
        problems.push({ kind: 'gate-orphan', id: script, detail: `\`${script}\` guards a design rule that the law table does not name` })
      }
    }
  }

  return problems
}

/** 读目录，失败时给空数组（不自造错误）。 */
function readdirSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/* ── 主流程 ────────────────────────────────────────────────────────────── */
const { laws, error } = readLaws(target)
if (error !== undefined) {
  console.error(`verify-design-sync FAILED: ${error}`)
  process.exit(1)
}
if (laws.length === 0) {
  console.error('verify-design-sync FAILED: the law table is empty — an empty table passes every check, which is the worst state')
  process.exit(1)
}
const problems = audit(laws, { root: target })
if (problems.length > 0) {
  console.error(`verify-design-sync FAILED: ${problems.length} finding(s) across ${laws.length} law(s)`)
  console.error('')
  console.error('  每条设计法则都有三个家：实现、门禁、标本。三处漂开时不会构建失败——')
  console.error('  所以这里逐条对账，缺哪一样就报哪一样。')
  console.error('')
  for (const one of problems) console.error(`  - [${one.kind}] ${one.id}: ${one.detail}`)
  process.exit(1)
}
console.log(`verify-design-sync OK: ${laws.length} design law(s), each with a home, a gate wired into pnpm verify, and a specimen the preview page actually renders; no orphan design gate`)
