/**
 * 检查更新的**整个对话框**：状态、派生、渲染，全在这里。
 *
 * ── 为什么它必须是一个共享组件，而不是每页写一遍 ───────────────────────────
 *
 * 这个对话框原先住在看板页面的组件里。于是「按了按钮没反应」这件事的成因不是缺陷，
 * 是**装配**：按钮由 `WorkbenchBar` 在三个页面都渲染了（`checking` / `onCheck`），
 * 而对话框只跟着看板那一页的 JSX 走。结果是同一个按钮有两种行为——看板页能弹出、
 * 另外两页什么都不发生。
 *
 * 那不是「漏改一处」，是**一个功能被拆在两个地方**：触发在共享层，结果在页面层。
 * 每加一个新页面，这个缺口就再出现一次，而它不报错、不红、测试也过——因为每一页
 * 各自都「正确地」渲染了自己那份 JSX。
 *
 * 所以修法不是「再去另外两页各挂一份」，而是把整个功能收进一个组件，**由每一页
 * 通过 `WorkbenchOverlays` 渲染同一份**。加第 4、第 5 个页面时照抄一行，而「有没有
 * 抄」由 `design-coverage.spec.ts` 的一个断言回答，不靠记得。
 *
 * ── 为什么它可以自足 ────────────────────────────────────────────────────────
 *
 * 对话框要的每一样东西都来自 `updateController`（模块单例）：开关是 `state.open`，
 * 复制提示是 `state.copied` / `state.copyFailed`，派生值是 `controller.derived()`，
 * 命令文案是 `commandLineOf` / `commandWordsOf`。没有一项是「哪一页」的产物，
 * 所以它不接受任何 props——页面也就不必知道它存在。
 *
 * @module dsh-task-board/workbench/UpdateDialog
 */
import { Fragment } from 'react'
import { Button } from '../design/ui.tsx'
import { Dialog } from '../design/Dialog.tsx'
import { t } from '../locales.ts'
import { updateController } from './update-controller.ts'
import { useUpdateState } from './use-update.ts'
import { commandLineOf, commandWordsOf } from '../../core/update-check.ts'
import type { UpdateInstallMode } from '../../core/update-check.ts'
import type { UpdateApplyResult } from '../../host/update-apply.ts'
import css from './update-dialog.module.css'

/**
 * 装法的一句话名字（一个 mode 一支，因为 locale 的键不能动态拼）。
 * @param mode - 本机是怎么装的。
 * @returns the localised label.
 */
function updateModeLabel(mode: UpdateInstallMode): string {
  if (mode === 'npm') return t('board.update.mode.npm')
  if (mode === 'github') return t('board.update.mode.github')
  if (mode === 'local') return t('board.update.mode.local')
  return t('board.update.mode.unknown')
}

/**
 * 那行可复制命令上方的提示。只有三条走终端的路有；读不出装法时根本没有命令，
 * 给它配一句提示等于解释一个不存在的东西。
 * @param mode - 本机是怎么装的。
 * @returns the hint, or `undefined` when this mode has none.
 */
function updateCommandHintOf(mode: UpdateInstallMode): string | undefined {
  if (mode === 'npm') return t('board.update.hint.npm')
  if (mode === 'github') return t('board.update.hint.github')
  if (mode === 'local') return t('board.update.hint.local')
  return undefined
}

/**
 * 更新为什么没能应用，用读者的话说。
 * @param error - the apply result's error code.
 * @returns the localised reason.
 */
function updateReasonOf(error: NonNullable<UpdateApplyResult['error']>): string {
  if (error === 'dirty') return t('board.update.reason.dirty')
  if (error === 'tool-missing') return t('board.update.reason.toolMissing')
  if (error === 'timeout') return t('board.update.reason.timeout')
  if (error === 'unavailable') return t('board.update.reason.unavailable')
  if (error === 'unsupported') return t('board.update.reason.unsupported')
  return t('board.update.reason.failed')
}

/**
 * 一次更新做成了什么，一句话。
 *
 * 「跑完版本没动」不是一次成功：安装服务报的是包管理器做成了什么，而「装最新版」
 * 解析到已经装着的那个版本时，它成功退出、什么也没做——把这件事说成「已更新到 v」
 * 正是读者无法核对、却会照着它行动的那句话。
 * @param result - the apply result.
 * @returns the localised sentence.
 */
function updateOutcomeOf(result: UpdateApplyResult): string {
  const v = result.version ?? t('board.update.versionUnknown')
  if (result.outcome === 'applied') return t('board.update.applied', { v })
  if (result.outcome === 'rebuilt') return t('board.update.rebuilt', { v })
  if (result.outcome === 'unchanged') return t('board.update.unchanged', { v })
  return t('board.update.restartRequired', { v })
}

/**
 * 检查更新的对话框。**每一页都渲染同一份**，所以每个页面说到做到。
 *
 * 关着的时候返回 `null`：它常驻在页面上，但闭着时不该留任何痕迹（不占布局、
 * 不参与键盘）。
 * @returns the dialog, or `null` while it is closed.
 */
export function UpdateDialog() {
  const update = useUpdateState()
  /* 关着时直接退出：打开是少数情况，没必要为它每次渲染都算一遍。 */
  if (!update.open) return null

  const source = update.source
  const derived = updateController.derived()
  const plan = derived.plan
  const latest = derived.latest
  const git = derived.git
  const command = plan !== undefined && plan.steps.length > 0 ? commandLineOf(plan.steps) : undefined
  /* 命令按「一个词一格」画：换行只发生在词之间。整条命令是要照着敲的，而浏览器
     默认会在连字符处断行，于是包名被画成两个词那样的两截。 */
  const words = plan !== undefined ? commandWordsOf(plan.steps) : []
  const commandHint = source !== undefined ? updateCommandHintOf(source.mode) : undefined
  const blocked = plan?.apply === 'checkout' && git?.dirty === true
  const running = update.apply.phase === 'running'
  /* **终态里只有两个让动作消失。**
     `done` 与 `failed` 都意味着「这一次走完了，没有可再按的东西」；而
     `unchanged` 不一样——它是「跑完了，版本没动」，保护期过了或换个装法之后同一个
     按还有意义，所以按钮**要留着**。把它一并藏起来，读者会以为这条路到此为止。 */
  const actionSpent = update.apply.phase === 'done' || update.apply.phase === 'failed'
  const canApply = plan !== undefined && plan.apply !== 'none' && !actionSpent
  const reported = update.apply.phase === 'done' || update.apply.phase === 'unchanged'
  const published = latest?.publishedAt !== undefined
    ? new Date(latest.publishedAt).toLocaleString()
    : undefined
  const close = (): void => { updateController.setOpen(false) }

  return (
    <Dialog
      label={t('board.update.title')}
      title={t('board.update.title')}
      onClose={close}
      portal
    >
      <div className={css.body}>
        <p className={css.text}>{t('board.update.current', { v: derived.current })}</p>
        {/* 这是哪一份：同一台机器上 Web 端与桌面端是两份独立安装，读者
            最先要确认的就是「我现在看的是哪一份」。 */}
        {source !== undefined && (
          <p className={css.hint}>
            {source.profile !== undefined
              ? t('board.update.where', { profile: source.profile, mode: updateModeLabel(source.mode) })
              : t('board.update.source', { mode: updateModeLabel(source.mode) })}
          </p>
        )}
        {source?.dir !== undefined && (
          <p className={css.hint}>{t('board.update.dir', { path: source.dir })}</p>
        )}
        {source?.spec !== undefined && (
          <p className={css.hint}>{t('board.update.spec', { spec: source.spec })}</p>
        )}
        {source?.evidence?.disagreement === true && (
          <p className={css.hint}>{t('board.update.evidence')}</p>
        )}
        {latest !== undefined && source?.mode === 'github' && (
          <p className={css.text}>{t('board.update.remoteVersion', { v: latest.version })}</p>
        )}
        {latest !== undefined && source !== undefined && source.mode !== 'github' && (
          <p className={css.text}>
            {derived.newer
              ? t('board.update.newVersion', { v: latest.version })
              : t('board.update.latest')}
          </p>
        )}
        {published !== undefined && (
          <p className={css.hint}>{t('board.update.published', { when: published })}</p>
        )}
        {/* 问的是哪个源：读者配了镜像时要能确认读到的是自己那个源，而不是公共源。 */}
        {latest?.registry !== undefined && (
          <p className={css.hint}>{t('board.update.registry', { registry: latest.registry })}</p>
        )}
        {source?.mode === 'github' && latest !== undefined && !derived.newer && (
          <p className={css.hint}>{t('board.update.gitSameVersion')}</p>
        )}
        {/* **读不到远端版本，不等于检查失败。** 本地事实（装法、当前版本、怎么更新）
            仍然成立，所以这里说的是「读不到」，而不是把它画成一次错误。 */}
        {latest === undefined && source !== undefined && source.mode !== 'local' && (
          <p className={css.hint}>{t('board.update.noLatest')}</p>
        )}
        {source?.mode === 'local' && git !== undefined && derived.gitBehind && (
          <p className={css.hint}>
            {t('board.update.gitBehind', { head: git.head.slice(0, 8), remote: (git.remoteHead ?? '').slice(0, 8) })}
          </p>
        )}
        {/* 一个 checkout 的答案来自它自己的 git 状态，不是发布号：本地与远端一致时
            要说「已同步」，而不是让读者对着空白的「远端」那一行猜。 */}
        {source?.mode === 'local' && git !== undefined && !derived.gitBehind
          && git.remoteHead !== undefined && (
          <p className={css.hint}>{t('board.update.gitUpToDate')}</p>
        )}
        {/* 读不出装法时**没有命令可给**，那是一种要说清的状态：不是「检查失败」，而是
            「这份 profile 里没有这个包的安装声明」。读者据此知道该按当初装它的方式重装，
            而不是以为按钮坏了。 */}
        {source?.mode === 'unknown' && (
          <p className={css.hint}>{t('board.update.unreadable')}</p>
        )}
        {/* 更新正在跑：页面可能短暂失去连接。这句话只在**跑的时候**有意义——它是给
            正在等的人一颗定心丸，不是一条常驻的说明。 */}
        {running && <p className={css.hint}>{t('board.update.losingConnection')}</p>}
        {blocked && <p className={css.warn}>{t('board.update.gitDirty')}</p>}
        {source?.appManaged === true && (
          <p className={css.hint}>{t('board.update.appManaged')}</p>
        )}
        {commandHint !== undefined && <p className={css.hint}>{commandHint}</p>}
        {words.length > 0 && (
          /* `<code>` 是语义，不是装饰：这是一条要照抄进终端的命令，读屏与工具栏把它当
             代码而不是正文。每个词一个 `<span>`，靠 `white-space: nowrap` 保证连字符
             处不被拆开（浏览器默认会在连字符后换行，把包名画成两个词）。

             **空格必须是一个真实的文本节点，不能靠 JSX 换行。** React 会丢掉相邻元素
             之间的空白文本节点，于是 `textContent` 变成 `dshplugin--profilewebadd`——
             屏上看着有间距（那些 span 本该挨在一起），而从对话框里选中复制出来的是一串
             连在一起的字，粘到终端里就错。所以这里显式插入 `' '`：词元素自己不带空格
             （否则「一个词」这个断言读到的是带前导空格的字符串），空格是它**旁边**的
             一个兄弟节点。列表行用 `Fragment` 包住这一对。 */
          /* `<code>` 本身**不带类**：它是语义容器（「这是一段可照抄的命令」），
             版面全部在包裹它的那一格与每个词上。结构因此是最朴素的那种：
             `<code><span class="word">dsh</span> <span class="word">plugin</span></code>` */
          <div className={css.commandFrame}>
            <code>
              {words.map((word, index) => (
                <Fragment key={`${word}-${String(index)}`}>
                  <span className={css.word}>{word}</span>
                  {index === words.length - 1 ? null : ' '}
                </Fragment>
              ))}
            </code>
          </div>
        )}
        {/* 「一键更新」会做什么，是**按下之前**要知道的事，所以只在这一次还没走完时
            显示：`reinstall` 时先卸再装（插件会短暂消失）；否则直接覆盖（装完要重启）。
            这两句话由 host 的 plan 说，不由页面猜——见 `UpdatePlan.reinstall` 的注释。
            **跑完之后留在屏上的是结果，不是预告**：把预告和结果并排放，读者分不清
            那句「会先卸载」说的是将要发生还是刚刚发生。 */}
        {!actionSpent && plan !== undefined && plan.apply === 'package' && plan.reinstall === true && (
          <p className={css.hint}>{t('board.update.reinstall')}</p>
        )}
        {!actionSpent && plan !== undefined && plan.apply === 'package' && plan.reinstall !== true && (
          <p className={css.hint}>{t('board.update.overwrite')}</p>
        )}
        {!actionSpent && plan !== undefined && plan.apply !== 'none' && (
          <p className={css.hint}>{t('board.update.restart')}</p>
        )}
        {reported && update.apply.result !== undefined && (
          /* **一次更新做成了什么，不是一句「成功」。** 四种结果各有自己的说法：
             `applied` / `rebuilt` / `unchanged` / `restart-required`。其中 `unchanged`
             最重要——「装最新版」解析到已经装着的那个版本时，安装服务成功退出、什么也
             没做，把这件事说成「已更新到 v」正是读者无法核对、却会照着它行动的那句话。 */
          <p className={css.text}>{updateOutcomeOf(update.apply.result)}</p>
        )}
        {/* **死胡同要带着出路。** 一次跑完没换版本，读者只知道自己还停在旧版上；而这一
            刻对话框两样东西都已经知道——被挡下的是哪一版，以及「按指定版本装」那条路。
            只在**确实有更新的一版**时说出来：没有可说的一版时，把它画成「被观察期挡住」
            是凭空造一个原因。 */}
        {update.apply.phase === 'unchanged' && latest !== undefined && derived.newer
          && source?.packageName !== undefined && (
          <p className={css.hint}>
            {t('board.update.unchangedHeld', {
              latest: latest.version,
              spec: `${source.packageName}@${latest.version}`,
            })}
          </p>
        )}
        {update.apply.phase === 'failed' && update.apply.result !== undefined && (
          <p className={css.warn}>{t('board.update.applyFailed')}</p>
        )}
        {update.apply.phase === 'failed' && update.apply.result?.error !== undefined && (
          <p className={css.warn}>{updateReasonOf(update.apply.result.error)}</p>
        )}
        {/* 命令打印出来的那段尾巴，就是它给的理由。用代码框画：它是要被**读**的
            报错文本，不是一句给人听的解释。 */}
        {update.apply.result?.output !== undefined && update.apply.result.output !== '' && (
          <pre className={css.output}>{update.apply.result.output}</pre>
        )}
        {plan?.apply === 'none' && (
          <p className={css.warn}>{t('board.update.unrouted', { spec: source?.spec ?? source?.mode ?? '' })}</p>
        )}
      </div>
      <footer className={css.footer}>
        {source !== undefined && plan !== undefined && plan.apply !== 'none' && !actionSpent && (
          <Button
            variant={canApply ? 'primary' : 'ghost'}
            disabled={running || blocked}
            onClick={() => { updateController.run() }}
          >
            {running ? t('board.update.applying') : t('board.update.apply')}
          </Button>
        )}
        {command !== undefined && (
          <Button
            variant="ghost"
            onClick={() => { updateController.copyCommand(command) }}
          >
            {update.copied
              ? t('detail.copied')
              : update.copyFailed ? t('detail.copyFailed') : t('board.update.copy')}
          </Button>
        )}
        <Button variant={canApply ? undefined : 'primary'} disabled={running} onClick={close}>
          {t('detail.close')}
        </Button>
      </footer>
    </Dialog>
  )
}