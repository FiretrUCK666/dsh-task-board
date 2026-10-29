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
export declare function compareWithPreRelease(left: string, right: string): number;
/**
 * 从一段版本范围里取出它的下界。
 *
 * 三种写法都要认：`>=1.2.3`、`^1.2.3`、`~1.2.3`——它们都表示「至少这一版」（`^` 与 `~`
 * 上界不同，但**下界都是那个数字**，而这条判定只关心下界）。
 *
 * @param range - 例如 `>=0.2.2-alpha.2`。
 * @returns 下界版本号；认不出（如 `latest`、`*`）时 `undefined`。
 */
export declare function lowerBoundOf(range: string | undefined): string | undefined;
/** 检查时需要的那几份文件内容。**由调用方提供**，所以这个模块不碰文件系统，可单独测。 */
export interface VersionSyncInput {
    /** `package.json` 解析后的对象。 */
    readonly manifest: Record<string, unknown>;
    /** `pnpm-workspace.yaml` 全文；缺省表示没有这份文件。 */
    readonly workspace?: string | undefined;
    /** `pnpm-lock.yaml` 全文；缺省表示没有这份文件。 */
    readonly lock?: string | undefined;
    /** `lib/client.js` 全文；缺省表示还没构建。 */
    readonly bundle?: string | undefined;
    /**
     * **实际正在运行的那台 DSH 的版本**。缺省表示读不到（没装 / 判断不了）。
     *
     * ── 为什么它必须在 ──────────────────────────────────────────────────────
     *
     * 上面那几条判据比对的是**仓库里几份文件之间**的一致性。它们查不出最重要的那种漂移：
     * **DSH 升级了，而我们的 `devDependencies` 还钉在上一版**。
     *
     * 那种漂移**不会让构建失败**（旧版类型照样能编译），但会让插件按**上一代契约**去写，
     * 而用户装的是新一代 DSH——于是「我们以为还对」的代码在用户那边静默失效。它也不会让任何
     * 现有判据变红，因为仓库内部**是自洽的**。
     *
     * 所以这条判据必须读**外部事实**（实际运行的那台 DSH 的版本），而不是仓库内部。这样
     * 「升了 DSH 忘了同步」会在 `pnpm verify` 时报红，而不是靠谁记得去跑一条命令。
     */
    readonly runningDsh?: string | undefined;
}
/**
 * 检查版本一致性。
 *
 * @param input - 那几份文件的内容。
 * @returns 问题清单，空数组即通过。
 */
export declare function versionSyncProblems(input: VersionSyncInput): string[];
