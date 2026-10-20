/**
 * 工作台总览：这一页只回答一句话——**现在该我出手什么**。
 *
 * 它不是一个报表。页面上每一个计数都是某个地方的门：数字告诉你那边有多少事，按一下
 * 就把你送到能处理它的那一页。所以这一页的每个数字都来自**已经在别处生效的那条推导**，
 * 不在这里另算一遍：
 *
 *   - 「等你处理 / 待审核」 = `workbenchStage.summaryOf()` 的 `counts.demand` / `review`，
 *     也就是看板板头与通知抽屉读的那一对（`boardDemandOf`）；会话卡上的「等你回答」
 *     读的是同一次推导里的 `counts.waiting`。
 *   - 「今天到期 / 已逾期」 = 同一个 summary 的 `dueToday` / `overdue`，与清单每一行标题
 *     下面印的那个判决同源（`datePostureOf`）。
 *   - 流水线、吞吐、最近动态全都来自 `core/workbench-summary.ts` 的同一个视图模型。
 *
 * 三条「读不到时说什么」的规矩，写在这里一次：
 *
 *   1. 没有看板控制器 = **读不到**，不是「零」。这时整页只有一句话（`home.loadFailed`），
 *      一个数字都不画。
 *   2. `flow.p85Days` 缺席 = 还没有可测的完成，整块吞吐说「还没有样本」，**绝不显示 0**。
 *   3. 空列没有「最旧」这回事（`staleDays === undefined`）：不写「0 天没动」，那会把
 *      「没有东西」说成「今天刚动过」。
 *
 * 会话卡里的「等你回答」读的是 summary 公布的 `waiting`——`boardDemandOf` 里那一档，
 * 挂起等你回答的那些会话。**它不是减出来的**：以前这一页写的是「总诉求减待复核」，
 * 那个减法今天成立只因为 `total = waiting + review`；等诉求多出第三种，它就静默算错了，
 * 而屏上没有任何东西会说明为什么。
 *
 * 重画的方式只有一条：`useBoardSnapshot` 订阅看板。清单那一侧不在这里再挂监听——副本只
 * 允许一个远端监听者，而它属于清单面板自己（见 `workbench/stage.ts` 的头注释）；两个与
 * 日期有关的计数在跨过午夜时变化，而读者不会盯着一个数字等它跳。
 */
import type { CSSProperties, ReactNode } from 'react'
import type { PipelineRow, RecentCard } from '../../core/workbench-summary.ts'
import type { TaskBoardKey } from '../locales.ts'
import { t } from '../locales.ts'
import { useBoardSnapshot } from '../board/use-board-snapshot.ts'
import { formatDateTime, formatTime } from '../board/format-time.ts'
import { STATUS_KEY } from '../board/status.ts'
import { WorkbenchShell } from '../design/WorkbenchShell.tsx'
import { Button } from '../design/ui.tsx'
import type { WorkbenchPage } from '../workbench/chrome.ts'
import { workbenchChromeOf } from '../workbench/chrome.ts'
import { workbenchStage } from '../workbench/stage.ts'
import { updateController } from '../workbench/update-controller.ts'
import { updateLabelOf, useUpdateState } from '../workbench/use-update.ts'
import { WorkbenchOverlays } from '../workbench/WorkbenchOverlays.tsx'
import base from '../design/base.module.css'
import css from './home.module.css'
import components from '../design/components.module.css'

/** 四格：哪一格、叫什么、一句说明、按下去去哪。 */
interface HomeTile {
  readonly value: number
  readonly label: TaskBoardKey
  readonly hint: TaskBoardKey
  readonly page: WorkbenchPage
}

/**
 * 一页的总览。
 *
 * @param props.now - 这一次读数的时刻，注入进 `summaryOf`。截图台用它把「今天」钉在
 *   夹具那一天；产品里不传，读真实时钟。它是一个种子而不是覆盖：页面照样跟着看板重画。
 * @returns 页面本身。
 */
export function HomePage({ now }: { readonly now?: number }) {
  const controller = workbenchStage.controller()
  // 这一行就是「看板改了，这一页跟着重画」的那根线。快照本身不参与计算（summary 自己
  // 现读两份文档），但没有它这一页在数据变动时就停在旧数字上。
  const board = useBoardSnapshot(controller)
  const chrome = workbenchChromeOf()
  const at = now ?? Date.now()

  if (controller === undefined || board === undefined) {
    return (
      <HomeShell chrome={chrome}>
        <div className={css.homeEmptyWrap}>
          <section className={css.emptySheet}>
            <p className={css.noticeText} role="status">{t('home.loadFailed')}</p>
          </section>
        </div>
      </HomeShell>
    )
  }

  const summary = workbenchStage.summaryOf(at)
  const counts = summary.counts
  const tiles: readonly HomeTile[] = [
    { value: counts.demand, label: 'home.tile.demand', hint: 'home.tile.demandHint', page: 'board' },
    { value: counts.review, label: 'home.tile.review', hint: 'home.tile.reviewHint', page: 'board' },
    { value: counts.dueToday, label: 'home.tile.dueToday', hint: 'home.tile.dueTodayHint', page: 'items' },
    { value: counts.overdue, label: 'home.tile.overdue', hint: 'home.tile.overdueHint', page: 'items' },
  ]
  const empty = counts.demand === 0
    && counts.review === 0
    && counts.running === 0
    && counts.dueToday === 0
    && counts.overdue === 0
    && summary.pipeline.every(row => row.count === 0)

  if (empty) {
    const openBoard = (): void => { workbenchStage.navigate('board') }
    return (
      <HomeShell chrome={chrome}>
        <div className={css.homeEmptyWrap}>
          <section className={css.emptySheet}>
            <h2 className={css.emptyTitle}>{t('home.emptyTitle')}</h2>
            <p className={css.emptyBody}>{t('home.emptyBody')}</p>
            <div className={css.emptyActions}>
              <Button variant="primary" onClick={openBoard}>{t('home.emptyNew')}</Button>
              <Button onClick={openBoard}>{t('home.emptyFromSession')}</Button>
            </div>
          </section>
        </div>
      </HomeShell>
    )
  }

  const opened = workbenchStage.openCardOf()
  const openRecent = (cardId: string): void => { if (opened !== undefined) opened(cardId) }
  const pipelineTotal = summary.pipeline.reduce((total, row) => total + row.count, 0)
  const weekPeak = Math.max(1, ...summary.weeks)
  const flow = summary.flow

  return (
    <HomeShell chrome={chrome}>
      <header className={css.homeHead}>
        {/* **一个 h1，没有眉题。** 主次由字号档差建立——句子 24/700、四格的数 30/600、
            卡片题 11/600、辅助 12；那一组数字与它们的令牌出处写在 `home.module.css`
            的标题行一段里。 */}
        <h1 className={css.pageTitle}>
          {counts.demand === 0
            ? `${t('home.title')} ${t('home.subtitleCalm')}`
            : `${t('home.title')} ${t('home.subtitle', { n: String(counts.demand) })}`}
        </h1>
      </header>

      <div className={css.tiles}>
        {tiles.map(tile => (
          <button
            key={tile.label}
            type="button"
            className={`${css.tile} ${base.paperSheet} ${base.paperLift}`}
            onClick={() => { workbenchStage.navigate(tile.page) }}
          >
            {/* 数与它的标签同一条基线：一枚 30px 的数和 12px 的标签若各占一行，读者要
                来回对两次；并成一行之后，「3 等你处理」是一个读数，不是两行字。 */}
            <span className={css.tileFigures}>
              <span className={css.tileValue}>{tile.value}</span>
              <span className={css.tileLabel}>{t(tile.label)}</span>
            </span>
            <span className={css.tileHint}>{t(tile.hint)}</span>
          </button>
        ))}
      </div>

      <div className={css.homeColumns}>
        <section className={`${css.homeCard} ${base.paperSheet}`}>
          <h2 className={css.homeCardTitle}>{t('home.pipeline')}</h2>
          <div className={css.pipeline}>
            {summary.pipeline.map(row => (
              <PipelineLine key={row.status} row={row} total={pipelineTotal} />
            ))}
          </div>
        </section>

        <section className={`${css.homeCard} ${base.paperSheet}`}>
          <h2 className={css.homeCardTitle}>{t('home.throughput')}</h2>
          {flow.p85Days === undefined
            ? <p className={css.homeCardEmpty}>{t('home.flowEmpty')}</p>
            : (
              <>
                <div className={css.flowStats}>
                  <div className={css.flowStat}>
                    <span className={css.flowLabel}>{t('home.cycle')}</span>
                    <span className={css.flowValue}>
                      {t('home.cycleValue', { n: roundOne(flow.p85Days) })}
                    </span>
                  </div>
                  <div className={css.flowStat}>
                    <span className={css.flowLabel}>{t('home.perWeek')}</span>
                    <span className={css.flowValue}>
                      {t('home.perWeekValue', { n: roundOne(flow.perWeek) })}
                    </span>
                  </div>
                </div>
                {/* 一排纯 div 的竖条：四周完成数。它是一张走势图，数字在它上面一行里，
                    所以它对读屏是装饰（aria-hidden），不另造一句只有它才看得懂的说明。 */}
                <div className={css.weekChart} aria-hidden="true">
                  {summary.weeks.map((count, index) => (
                    <span
                      key={index}
                      className={css.weekBar}
                      style={{ blockSize: `${Math.round((count / weekPeak) * 100)}%` }}
                    />
                  ))}
                </div>
                <p className={css.weekCaption}>{t('home.weeks')}</p>
              </>
            )}
        </section>

        <section className={`${css.homeCard} ${base.paperSheet}`}>
          <h2 className={css.homeCardTitle}>{t('home.activity')}</h2>
          {summary.recent.length === 0
            ? <p className={css.homeCardEmpty}>{t('home.activityEmpty')}</p>
            : (
              <ul className={css.recentList}>
                {summary.recent.map(card => (
                  <li key={card.id} className={css.recentItem}>
                    {opened === undefined
                      ? <div className={css.recentRow}>{recentBodyOf(card)}</div>
                      : (
                        <button
                          type="button"
                          className={`${css.recentRow} ${css.recentRowAction}`}
                          onClick={() => { openRecent(card.id) }}
                        >
                          {recentBodyOf(card)}
                        </button>
                      )}
                  </li>
                ))}
              </ul>
            )}
        </section>

        <section className={`${css.homeCard} ${base.paperSheet}`}>
          <h2 className={css.homeCardTitle}>{t('home.sessions')}</h2>
          {counts.running + counts.waiting === 0
            ? <p className={css.homeCardEmpty}>{t('home.sessionsEmpty')}</p>
            : (
              <div className={css.sessionStats}>
                <button
                  type="button"
                  className={`${css.sessionStat} ${base.paperSheet} ${base.paperLift}`}
                  onClick={() => { workbenchStage.navigate('board') }}
                >
                  <span className={css.sessionValue}>{counts.running}</span>
                  <span className={css.sessionLabel}>{t('home.sessionsRunning')}</span>
                </button>
                <button
                  type="button"
                  className={`${css.sessionStat} ${base.paperSheet} ${base.paperLift}`}
                  onClick={() => { workbenchStage.navigate('board') }}
                >
                  <span className={css.sessionValue}>{counts.waiting}</span>
                  <span className={css.sessionLabel}>{t('home.sessionsWaiting')}</span>
                </button>
              </div>
            )}
        </section>
      </div>
    </HomeShell>
  )
}

/** 页面外壳：共用框架（`design/WorkbenchShell.tsx`）负责栏、警告与几何，页面只给内容。 */
function HomeShell({ chrome, children }: { readonly chrome: ReturnType<typeof workbenchChromeOf>; readonly children: ReactNode }) {
  const update = useUpdateState()
  return (
    <WorkbenchShell
      active="home"
      tabs={chrome.tabs}
      label={t('workbench.navLabel')}
      status={chrome.status}
      checking={update.phase === 'checking'}
      checkLabel={updateLabelOf(update)}
      onCheck={() => { updateController.check() }}
      exitLabel={chrome.exitLabel}
      onExit={chrome.onExit}
      onNavigate={chrome.onNavigate}
      notices={chrome.notices}
      scrolls
      seat="data-dsh-taskboard-view"
      overlay={<WorkbenchOverlays />}
    >
      <div className={css.homeSheet}>{children}</div>
    </WorkbenchShell>
  )
}

/**
 * 流水线的一行。
 *
 * 整行是一枚按钮：状态点、名字、计数、占比条、最旧滞留。占比条是装饰（数字就在旁边），
 * 所以它对读屏隐藏，读出来的那句是「进行中 3 最旧 2 天没动」。
 * @param props.row - 这一栏的读数。
 * @param props.total - 五栏合计，只用来算条的宽度。
 * @returns 一行。
 */
function PipelineLine({ row, total }: { readonly row: PipelineRow; readonly total: number }) {
  const share = total === 0 ? 0 : Math.round((row.count / total) * 100)
  const barStyle: CSSProperties = { inlineSize: `${share}%` }
  return (
    <button type="button" className={`${css.pipeRow} ${base.paperSheet} ${base.paperLift}`} onClick={() => { workbenchStage.navigate('board') }}>
      <span className={css.homeStatusDot} data-status={row.status} aria-hidden="true" />
      <span className={`${css.pipeName} ${components.titleText}`}>{t(STATUS_KEY[row.status])}</span>
      <span className={css.pipeCount}>{row.count}</span>
      <span className={css.pipeTrack} aria-hidden="true">
        <span className={css.pipeFill} style={barStyle} />
      </span>
      <span className={css.pipeStale}>{staleTextOf(row)}</span>
    </button>
  )
}

/**
 * 「这栏最旧的东西多久没动」的文案。
 *
 * `staleDays === undefined` 只发生在空列：一列没有最旧的东西，于是这一格也是空的——
 * 写「今天动过」会把「这里什么都没有」说成「刚有人干过活」。
 * @param row - 这一栏的读数。
 * @returns 那一句话，或空串。
 */
function staleTextOf(row: PipelineRow): string {
  if (row.count === 0 || row.staleDays === undefined) return ''
  return row.staleDays === 0
    ? t('home.pipelineFresh')
    : t('home.pipelineStale', { n: String(row.staleDays) })
}

/** 一条最近动态的内容：时间、标题、状态。读与按用的是同一份，所以两者不可能不一样。 */
function recentBodyOf(card: RecentCard): ReactNode {
  return (
    <>
      <time className={css.recentTime} dateTime={new Date(card.at).toISOString()} title={formatDateTime(card.at)}>
        {formatTime(card.at)}
      </time>
      <span className={css.recentTitle}>{card.title}</span>
      <span className={css.recentStatus}>
        <span className={css.homeStatusDot} data-status={card.status} aria-hidden="true" />
        {t(STATUS_KEY[card.status])}
      </span>
    </>
  )
}

/**
 * 一位小数，但去掉没有意义的 `.0`。
 *
 * 周期是「天」、吞吐是「张 / 周」，两个都是可能带小数的读数（p85 由日历日算出）。整数
 * 不该被写成 `2.0`，小数也不该被四舍五入成 0——那两件都是把一个真读数说成另一个。
 * @param value - 原始读数。
 * @returns 可读的数字串。
 */
function roundOne(value: number): string {
  return String(Number(value.toFixed(1)))
}
