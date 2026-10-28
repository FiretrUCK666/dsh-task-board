/**
 * 版本号一处权威：`package.json` 是唯一的声明，其余地方跟着它。
 *
 * ── 它判什么，为什么需要它 ──────────────────────────────────────────────────
 *
 * DSH 每次升级，`devDependencies` 里那十几个 `@deepseek-ai/dsh-*` 都要跟着抬。抬完这一处
 * 之后，仓库里还有四处会**沉默地**与它分家，而它们分家时全都不报错：
 *
 *   1. **`engines.dsh` 与 `peerDependencies`**——那是给用户的门槛，和「按哪版构建」不是
 *      一回事（见 AGENTS.md「最低支持版本」）。但下限**高于**构建版本时，等于要求用户装
 *      一个比我们自己测试的还新的版本，那是真的装不上。
 *   2. **`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`**——pnpm 有「新版本冷静期」，
 *      DSH 的 alpha 发得勤，所以要逐个点名豁免。**这张表点名就意味着会过期**：它写的还是
 *      上一版，那么真正要装的新版反而没被豁免，`pnpm install` 会在别人机器上失败。
 *   3. **`lib/` 里内嵌的版本**——版号在 build 时进包，所以「改了 version 却没重新构建」
 *      会让产物说自己是上一版。
 *   4. **文档与注释里记的「这个是在哪一版上核实的」**——那是给人看的地图，过期了会让人
 *      照着一张旧地图去找路。
 *
 * 这四处都不是「风格问题」：2 会让别人装不上，3 会让人以为自己在用新包，1 会让门槛变成
 * 谎话。而它们全都不会让构建失败——所以只能由这条判定守着。
 *
 * ── 判据为什么这样写 ────────────────────────────────────────────────────────
 *
 * **不写死任何版本号。** 每个判据都把 `package.json` 当作唯一权威，去问其它地方「你跟它
 * 一致吗」。所以在任何一版上跑都成立，升级不用来改这个模块——这正是「写原则，不写死」。
 *
 * 判据只读**结构**（哪个字段、哪个文件、哪个名字），不读字样：注释里提到某个版本号不构成
 * 一处声明。
 *
 * @module dsh-task-board/version-sync
 */

/** npm 包名 → 它属于 DSH 生态的那一类（只有这些要跟着 DSH 本体同号）。 */
const SDK_PATTERN = /^@deepseek-ai\/dsh-/

/** 一个版本号的解析结果。 */
interface ParsedVersion {
  /** 主次修订三段。 */
  readonly core: readonly [number, number, number]
  /** 预发布标签与序号；正式版为 `undefined`。 */
  readonly pre?: { readonly tag: string; readonly index: number }
}

/**
 * 把一个版本号拆成可比较的形状。
 *
 * @param text - 例如 `0.2.2-alpha.2`。
 * @returns 拆好的形状；认不出时 `undefined`。
 */
function parseVersion(text: string): ParsedVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/.exec(text)
  if (match === null) return undefined
  const pre = match[4] === undefined ? undefined : { tag: match[4], index: Number(match[5]) }
  const parsed: ParsedVersion = { core: [Number(match[1]), Number(match[2]), Number(match[3])], ...pre === undefined ? {} : { pre } }
  return parsed
}

/**
 * 比较两个版本号，**预发布后缀参与比较**。只看「谁更新」，不做 semver 全序。
 *
 * ── 它与 `core/update-check.ts` 的 `compareVersions` 不是同一件事 ──────────
 *
 * 那一份只比数字三段，**故意**忽略后缀：它服务的是「有没有新版本可装」，读的是 npm 上的
 * `latest` 与本地版本，两者都是正式版，后缀只会带来噪音（`0.2.81-rc.1` 对 `0.2.80` 判为
 * 更新是对的）。
 *
 * 这一份要回答的是另一个问题：**门槛有没有高于我们实际构建的那一版**。而 DSH 的版本是
 * `0.2.2-alpha.2` 这种形状——把后缀忽略掉，`0.2.2-alpha.2` 与 `0.2.2` 会被判成相等，于是
 * 「门槛写 0.2.2、构建的是 0.2.2-alpha.2」这种**真的装不上**的组合会被放过。
 *
 * 所以两个函数各答一件事，名字也必须不同：同名的第二份实现会让下一个人以为其中一份是
 * 抄的（`verify-one-implementation` 就是这么报的）。
 *
 * 没有预发布后缀视为**正式版**，它比任何 alpha/beta 都新。
 *
 * @param left - 版本号。
 * @param right - 版本号。
 * @returns 负数表示 left 更旧。
 */
export function compareWithPreRelease(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined || b === undefined) return 0
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index]
  }
  if (a.pre === undefined && b.pre === undefined) return 0
  if (a.pre === undefined) return 1
  if (b.pre === undefined) return -1
  if (a.pre.tag !== b.pre.tag) return a.pre.tag < b.pre.tag ? -1 : 1
  return a.pre.index - b.pre.index
}

/**
 * 从一段版本范围里取出它的下界。
 *
 * 三种写法都要认：`>=1.2.3`、`^1.2.3`、`~1.2.3`——它们都表示「至少这一版」（`^` 与 `~`
 * 上界不同，但**下界都是那个数字**，而这条判定只关心下界）。
 *
 * @param range - 例如 `>=0.2.2-alpha.2`。
 * @returns 下界版本号；认不出（如 `latest`、`*`）时 `undefined`。
 */
export function lowerBoundOf(range: string | undefined): string | undefined {
  const match = /(?:>=|\^|~)\s*v?(\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?)/.exec(range ?? '')
  if (match !== null) return match[1]
  /* 一个裸版本号（`1.2.3`）本身也是「精确这一版」，下界就是它。 */
  const bare = /^v?(\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?)$/.exec((range ?? '').trim())
  return bare === null ? undefined : bare[1]
}

/** 检查时需要的那几份文件内容。**由调用方提供**，所以这个模块不碰文件系统，可单独测。 */
export interface VersionSyncInput {
  /** `package.json` 解析后的对象。 */
  readonly manifest: Record<string, unknown>
  /** `pnpm-workspace.yaml` 全文；缺省表示没有这份文件。 */
  readonly workspace?: string | undefined
  /** `pnpm-lock.yaml` 全文；缺省表示没有这份文件。 */
  readonly lock?: string | undefined
  /** `lib/client.js` 全文；缺省表示还没构建。 */
  readonly bundle?: string | undefined
}

/** 读一个对象里的字符串字段。 */
function stringField(record: unknown, key: string): string | undefined {
  if (record === null || typeof record !== 'object') return undefined
  const value = (record as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * 检查版本一致性。
 *
 * @param input - 那几份文件的内容。
 * @returns 问题清单，空数组即通过。
 */
export function versionSyncProblems(input: VersionSyncInput): string[] {
  const problems: string[] = []
  const { manifest } = input

  /* 构建版本：`devDependencies` 里 DSH 生态那一批必须**同一个版本**，因为它们是同一个
     发行版拆出来的包，混着用就是把两代写法的类型塞进同一份代码。 */
  const devDependencies = (manifest as { devDependencies?: Record<string, string> }).devDependencies ?? {}
  const sdkVersions = new Map<string, string>()
  for (const [name, range] of Object.entries(devDependencies)) {
    if (SDK_PATTERN.test(name)) sdkVersions.set(name, range)
  }
  if (sdkVersions.size === 0) {
    problems.push('devDependencies 里一个 @deepseek-ai/dsh-* 都没有——这条判定就失去意义了，先确认清单是否被改坏')
    return problems
  }
  const buildVersions = new Set(sdkVersions.values())
  if (buildVersions.size > 1) {
    const detail = [...sdkVersions.entries()].map(([name, range]) => `${name}@${range}`).join('、')
    problems.push(`devDependencies 里 DSH 生态的包版本不一致（${detail}）——它们来自同一个发行版，必须同号`)
  }
  const buildVersion = [...buildVersions][0]

  /* 1. 门槛不得高于构建版本。 */
  const engines = (manifest as { engines?: Record<string, string> }).engines
  const floor = lowerBoundOf(stringField(engines, 'dsh'))
  if (floor === undefined) {
    problems.push('engines.dsh 没有可识别的下界（应为 >=x.y.z）——那是给用户的门槛，必须写得出')
  } else if (compareWithPreRelease(floor, buildVersion) > 0) {
    problems.push(`engines.dsh 的下界（${floor}）高于构建版本（${buildVersion}）——那等于要求用户装一个我们自己都没测过的版本`)
  }
  const peerDependencies = (manifest as { peerDependencies?: Record<string, string> }).peerDependencies ?? {}
  for (const [name, range] of Object.entries(peerDependencies)) {
    if (!SDK_PATTERN.test(name)) continue
    const peerFloor = lowerBoundOf(range)
    if (peerFloor === undefined) {
      problems.push(`peerDependencies.${name} 没有可识别的下界（应为 >=x.y.z）`)
      continue
    }
    if (compareWithPreRelease(peerFloor, buildVersion) > 0) {
      problems.push(`peerDependencies.${name} 的下界（${peerFloor}）高于构建版本（${buildVersion}）`)
    }
  }

  /* 2. 冷静期白名单必须覆盖 lockfile 里实际装到的每一个 DSH 包。
     白名单点名就意味着会过期：它若还写着上一版，真正要装的新版反而没被豁免。 */
  if (input.workspace !== undefined && input.lock !== undefined) {
    const excluded = new Set(
      [...input.workspace.matchAll(/-\s*'(@deepseek-ai\/[a-z0-9-]+)@(\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?)'/g)]
        .map(match => `${match[1]}@${match[2]}`),
    )
    const installed = new Set<string>()
    for (const match of input.lock.matchAll(/'?(@deepseek-ai\/dsh-[a-z0-9-]+)@(\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?)'?/g)) {
      installed.add(`${match[1]}@${match[2]}`)
    }
    const missing = [...installed].filter(entry => !excluded.has(entry)).sort()
    if (missing.length > 0) {
      problems.push(`pnpm-workspace.yaml 的 minimumReleaseAgeExclude 漏了 ${String(missing.length)} 个实际会装的包`
        + `（例如 ${missing.slice(0, 3).join('、')}）——漏掉的那个会在别人机器上被冷静期拦住，装不上`)
    }
    /* 反向也查：白名单里若还留着已经不装的旧条目，那张表就在说谎（它豁免的是没人要的版本）。 */
    const stale = [...excluded].filter(entry => !installed.has(entry)).sort()
    if (stale.length > 0) {
      problems.push(`pnpm-workspace.yaml 的 minimumReleaseAgeExclude 里有 ${String(stale.length)} 条指向没在装的版本`
        + `（例如 ${stale.slice(0, 3).join('、')}）——豁免一个没人装的版本等于这张表没在起作用`)
    }
  }

  /* 3. 产物里内嵌的版本必须等于 package.json 的 version。版号在 build 时进包，
     所以「改了 version 却没重新构建」会让产物说自己是上一版。 */
  const version = stringField(manifest, 'version')
  if (input.bundle !== undefined) {
    const embedded = /var version = "(\d+\.\d+\.\d+)"/.exec(input.bundle)
    if (embedded !== null && embedded[1] !== version) {
      problems.push(`lib/client.js 里内嵌的版本是 ${embedded[1]}，而 package.json 是 ${String(version)}`
        + '——改完版本要重新构建，否则产物会对外说自己是上一版')
    }
  }

  return problems
}
