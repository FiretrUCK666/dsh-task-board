/**
 * 版本号一致性的契约：一处权威，其余跟随，而分家必须被抓住。
 *
 * ── 这四条各自的现实对应 ────────────────────────────────────────────────────
 *
 * 1. 冷静期白名单写的是上一版 → `pnpm install` 在别人机器上被拦住（真装不上）。
 * 2. 门槛高于构建版本 → 要求用户装一个我们自己没测过的版本（门槛成了谎话）。
 * 3. 产物内嵌版本落后 → 包里说自己是上一版（人看「已安装」列表会被误导）。
 * 4. DSH 生态的包版本不一致 → 两代写法的类型塞进同一份代码（编译期不一定报）。
 *
 * 这四条都**不会让构建失败**，所以只能由这条判定守。判定本身是纯函数
 * （`versionSyncProblems` 吃文件内容、不碰磁盘），所以下面每一格都能拿假输入喂它。
 */
import { describe, expect, it } from 'vitest'
import { compareWithPreRelease, lowerBoundOf, versionSyncProblems } from '../src/host/version-sync.ts'

/** 一份各处都自洽的基线，用例只改动其中一处。 */
function baseline() {
  return {
    name: 'fixture',
    version: '1.0.0',
    engines: { dsh: '>=0.2.2-alpha.2' },
    devDependencies: {
      '@deepseek-ai/dsh-tools': '0.2.2-alpha.2',
      '@deepseek-ai/dsh-agent': '0.2.2-alpha.2',
    },
    peerDependencies: {
      '@deepseek-ai/dsh-host-webserver': '>=0.2.2-alpha.2',
    },
  }
}

const LOCK = "'@deepseek-ai/dsh-tools@0.2.2-alpha.2':\n'@deepseek-ai/dsh-agent@0.2.2-alpha.2':\n"
const WORKSPACE = "minimumReleaseAgeExclude:\n  - '@deepseek-ai/dsh-tools@0.2.2-alpha.2'\n  - '@deepseek-ai/dsh-agent@0.2.2-alpha.2'\n"

describe('version sync', () => {
  it('passes when everything follows package.json', () => {
    expect(versionSyncProblems({
      manifest: baseline(),
      workspace: WORKSPACE,
      lock: LOCK,
      bundle: 'var version = "1.0.0";',
    })).toEqual([])
  })

  it('catches a release-age whitelist that still names the previous version', () => {
    /* 现实对应：白名单写着上一版，于是真正要装的新版没被豁免，别人 `pnpm install` 直接失败。 */
    const stale = "minimumReleaseAgeExclude:\n  - '@deepseek-ai/dsh-tools@0.2.1-alpha.2'\n  - '@deepseek-ai/dsh-agent@0.2.1-alpha.2'\n"
    const problems = versionSyncProblems({ manifest: baseline(), workspace: stale, lock: LOCK })
    /* 两个方向都要报：漏了新版，且留着没人装的旧条目。 */
    expect(problems.some(problem => problem.includes('漏了'))).toBe(true)
    expect(problems.some(problem => problem.includes('没在装'))).toBe(true)
  })

  it('catches a floor that is newer than the version we build against', () => {
    /* 现实对应：门槛写成 0.3.0，而我们只在 0.2.2 上测过——那等于要求用户装一个没验过的版本。 */
    const manifest = baseline()
    manifest.engines = { dsh: '>=0.3.0' }
    const problems = versionSyncProblems({ manifest })
    expect(problems.some(problem => problem.includes('高于构建版本'))).toBe(true)
  })

  it('catches a bundle whose embedded version lags package.json', () => {
    /* 现实对应：改了 version 却没重新构建，装出来那个包对外说自己是上一版。 */
    const problems = versionSyncProblems({ manifest: baseline(), bundle: 'var version = "0.9.9";' })
    expect(problems.some(problem => problem.includes('内嵌的版本'))).toBe(true)
  })

  it('catches DSH packages pinned to different versions', () => {
    /* 现实对应：一半包抬了新版本、另一半忘了，两代类型写进同一份代码。 */
    const manifest = baseline()
    manifest.devDependencies = {
      '@deepseek-ai/dsh-tools': '0.2.2-alpha.2',
      '@deepseek-ai/dsh-agent': '0.2.1-alpha.3',
    }
    const problems = versionSyncProblems({ manifest })
    expect(problems.some(problem => problem.includes('版本不一致'))).toBe(true)
  })

  it('reads a floor out of a range, and orders prereleases below releases', () => {
    expect(lowerBoundOf('>=0.2.2-alpha.2')).toBe('0.2.2-alpha.2')
    expect(lowerBoundOf('^1.2.3')).toBe('1.2.3')
    expect(lowerBoundOf('~1.2.3')).toBe('1.2.3')
    expect(lowerBoundOf('latest')).toBeUndefined()
    expect(lowerBoundOf(undefined)).toBeUndefined()
    /* alpha 比正式版旧；同核心版本时 alpha.2 比 alpha.10 旧。 */
    expect(compareWithPreRelease('0.2.2-alpha.2', '0.2.2')).toBeLessThan(0)
    expect(compareWithPreRelease('0.2.2-alpha.2', '0.2.2-alpha.10')).toBeLessThan(0)
    expect(compareWithPreRelease('0.2.2', '0.2.2')).toBe(0)
    expect(compareWithPreRelease('0.3.0', '0.2.2')).toBeGreaterThan(0)
  })

  it('catches build deps that lag the DSH actually running here', () => {
    /* 现实对应：DSH 升级了，而我们的 devDependencies 还钉在上一版。
       那种情况下仓库内部**完全自洽**——旧版类型照样编译通过，上面每一条判据都不会红。
       所以这一格喂的是**外部事实**（实际运行的那台 DSH），而不是仓库里的另一份文件。 */
    const problems = versionSyncProblems({ manifest: baseline(), runningDsh: '0.3.0' })
    expect(problems.some(problem => problem.includes('落后于实际运行的 DSH'))).toBe(true)
  })

  it('stays quiet when the running DSH is the same version or older', () => {
    /* 反向：同版不报；比我们旧也不报（旧 DSH 上能跑说明下限还成立，那是另一条判据管的事）。 */
    expect(versionSyncProblems({ manifest: baseline(), runningDsh: '0.2.2-alpha.2' })).toEqual([])
    expect(versionSyncProblems({ manifest: baseline(), runningDsh: '0.2.1-alpha.3' })).toEqual([])
    /* 读不到实际版本时**不说谎也不误报**——这是它缺席时的诚实降级。 */
    expect(versionSyncProblems({ manifest: baseline() })).toEqual([])
  })
})
