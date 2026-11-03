/**
 * verify-read-write-parity — 可写的必须可读。
 *
 * 这一条守的不是一条风格规则，是一个**会让调用者只能猜**的缺陷：可写面比可读面
 * 大。真实发生过——模型能设六项运行配置、上排期、建会话规则，而唯一的查询只回
 * 标题与状态，于是「给这张卡加一条规则」这件事（要一个 session id）**没法正确
 * 完成**。剩下的动作只有猜，或者请人去屏幕上抄一个 id。
 *
 * 用例分三组，缺一不可：
 *
 *  · 真实仓库是安静的——否则门禁会被关掉；
 *  · 一个能写却读不回来的参数**报红**，而且指名；
 *  · 读不到输入**报红**，绝不静默通过。
 *
 * 豁免表不被信任，也被测：一条进表却没有理由的豁免，与漏掉一个没有区别。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NOT_A_FIELD,
  PROJECTION_FUNCTIONS,
  READ_AS,
  catalogParamsOf,
  projectionKeysOf,
  readWriteParityFindings,
  runConfigKeysOf,
} from '../scripts/verify-read-write-parity.mjs'

/** The real sources, read once: the quiet case must be judged on the real tree. */
function realInput() {
  const root = process.cwd()
  return {
    catalogText: readFileSync(join(root, 'src/core/board-actions.ts'), 'utf8'),
    toolsText: readFileSync(join(root, 'src/host/agent/tools.ts'), 'utf8'),
    runPresetsText: readFileSync(join(root, 'src/core/run-presets.ts'), 'utf8'),
  }
}

const CATALOG = `export const ACTIONS = {
  'task.create': {
    verb: 'create',
    params: {
      prompt: { about: 'x' },
      title: { optional: true, about: 'y' },
    },
  },
}
`

describe('the readers read structure, not words', () => {
  it('reads a write action&#39;s parameters', () => {
    expect(catalogParamsOf(CATALOG, [])).toEqual(['prompt', 'title'])
  })

  it('resolves a spread of the run-config table instead of ignoring it', () => {
    // An unresolved spread would hide six REAL parameters from the check — a gate
    // that passes on a subset it can see.
    const spread = "export const ACTIONS = {\n  'task.create': {\n    params: {\n      prompt: { about: 'x' },\n      ...RUN_CONFIG_PARAMS,\n    },\n  },\n}\n"
    expect(catalogParamsOf(spread, ['provider', 'model'])).toEqual(['prompt', 'provider', 'model'])
    // …and an unresolvable one is a finding, never a silent partial read.
    expect(catalogParamsOf(spread, null)).toBeNull()
  })

  it('reads the run-config keys off their own declaration', () => {
    expect(runConfigKeysOf("export const RUN_CONFIG_KEYS = ['provider', 'model'] as const")).toEqual(['provider', 'model'])
  })

  it('reads projection keys out of nested object literals', () => {
    // `schedule: { mode… }` — a nested field is as readable as a top-level one,
    // and reading only depth one would report a schedule parameter as unreadable.
    const tools = `function taskDeepRow(task: TaskRecord) {
  return compact({
    title: task.title,
    schedule: { mode: 'cron', cron: 'x' },
    sessions: [{ session: 's', rounds: 1 }],
  })
}
`
    const keys = projectionKeysOf(tools, ['taskDeepRow'])
    expect([...(keys ?? [])].sort()).toEqual(['cron', 'mode', 'rounds', 'schedule', 'session', 'sessions', 'title'].sort())
  })
})

describe('the real repository is quiet', () => {
  it('passes on the real catalog and the real projections', () => {
    expect(readWriteParityFindings(realInput())).toEqual([])
  })

  it('every exemption says WHY, because a silent exemption is an omission', () => {
    // An entry with an empty reason reads like a rule, protects nothing, and is
    // indistinguishable from the field simply being forgotten.
    for (const [name, why] of Object.entries(NOT_A_FIELD)) {
      expect(why, `${name} is exempted with no reason`).toBeTruthy()
      expect(why.length, `${name} is exempted with a placeholder, not a sentence`).toBeGreaterThan(8)
    }
    for (const [name, readAs] of Object.entries(READ_AS)) {
      expect(readAs, `${name} renames to nothing`).toBeTruthy()
    }
  })

  it('every projection function the gate names really exists', () => {
    // A name in this list that no function matches contributes no keys, so the
    // gate would quietly check less than it claims to.
    const tools = realInput().toolsText
    for (const name of PROJECTION_FUNCTIONS) {
      expect(new RegExp(`function\\s+${name}\\s*\\(`).test(tools), `${name} is in PROJECTION_FUNCTIONS but not in the source`).toBe(true)
    }
  })
})

describe('a parameter nobody can read back is a finding', () => {
  it('names the parameter and says what to do', () => {
    const out = readWriteParityFindings({
      catalogText: "export const ACTIONS = {\n  'task.create': {\n    params: {\n      smuggled: { about: 'x' },\n    },\n  },\n}\n",
      toolsText: 'function taskRow(task: TaskRecord): TaskRow {\n  return { title: task.title }\n}\n',
      runPresetsText: "export const RUN_CONFIG_KEYS = ['provider'] as const\n",
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('"smuggled"')
    expect(out[0]).toContain('NOT_A_FIELD')
  })

  it('is quiet when the projection carries the name', () => {
    const out = readWriteParityFindings({
      catalogText: "export const ACTIONS = {\n  'task.create': {\n    params: {\n      title: { about: 'x' },\n    },\n  },\n}\n",
      toolsText: 'function taskRow(task: TaskRecord): TaskRow {\n  return { title: task.title }\n}\n',
      runPresetsText: "export const RUN_CONFIG_KEYS = ['provider'] as const\n",
    })
    expect(out).toEqual([])
  })

  it('accepts a declared rename that lands on a real key', () => {
    // `bind` is read as `binds` — a deliberate difference, declared rather than
    // guessed, and resolved against the projection's own keys.
    const out = readWriteParityFindings({
      catalogText: "export const ACTIONS = {\n  'task.create': {\n    params: {\n      bind: { about: 'x' },\n    },\n  },\n}\n",
      toolsText: 'function taskDeepRow(task: TaskRecord) {\n  return { binds: [] }\n}\n',
      runPresetsText: "export const RUN_CONFIG_KEYS = ['provider'] as const\n",
    })
    expect(out).toEqual([])
  })
})

describe('an unreadable input is a finding, never a quiet pass', () => {
  it('reports a catalog it cannot read', () => {
    const out = readWriteParityFindings({ catalogText: 'export const nothing = 1\n', toolsText: 'function taskRow(t) { return { title: 1 } }\n', runPresetsText: '' })
    expect(out.some(finding => finding.includes('cannot read the write parameters'))).toBe(true)
  })

  it('reports a projection it cannot read', () => {
    const out = readWriteParityFindings({
      catalogText: "export const ACTIONS = {\n  'task.create': {\n    params: {\n      title: { about: 'x' },\n    },\n  },\n}\n",
      toolsText: 'export const nothing = 1\n',
      runPresetsText: "export const RUN_CONFIG_KEYS = ['provider'] as const\n",
    })
    expect(out.some(finding => finding.includes('cannot read the query projection'))).toBe(true)
  })
})
