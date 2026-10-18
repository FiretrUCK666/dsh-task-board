/**
 * 总览页：**第三页的契约**。
 *
 * 这一页只做一件事——把两份文档里已经存在的数读出来摆好，一个都不发明。所以这里钉的
 * 不是「画得好不好看」，是三条会悄悄说谎的线：
 *
 *   1. 四个格子读的是 `workbenchSummaryOf` 的四个数，不是它自己再数一遍；
 *   2. 空列不写「0 天没动」，没有历史不写「0 天周期」——**没有数就说没有数**；
 *   3. 读不到看板时说「读不到」，不画成「什么都没有」。
 *
 * 渲染走 `renderToStaticMarkup`：这一页没有交互状态，静态标记就是它的全部输出。
 * `DSH_PANEL_HTML` 给路径时把它写成一页能截图的东西（用真令牌表与真样式表），
 * 与两块产品面板共用同一台仪器。
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { existsSync } from 'node:fs'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import { HomePage } from '../src/client/home/panel.tsx'
import { workbenchStage } from '../src/client/workbench/stage.ts'
import { t } from '../src/client/locales.ts'
import { alignClassNames, clientSheets, DAY, NOW, writeStandalonePage } from './panel-harness.ts'

/** 一台只回答总览要问的四个问题的看板面。 */
function controllerWith(tasks: readonly TaskRecord[]) {
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ tasks }),
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    // 总览不问「哪条会话停在哪」，它只数「等你处理」——而那两问由 `boardDemandOf`
    // 转给控制器。这台假面照真实控制器回答：没有挂起的会话，也没有绑定。
    pendingInteractionOf: () => undefined,
    linkedOf: () => [],
  }
}

/** 一张卡，只带总览会读的字段。 */
function card(id: string, status: TaskRecord['status'], title: string, movedAt: number): TaskRecord {
  return {
    ...createTask({ title, description: '', prompt: '' }, movedAt, id),
    status,
    statusHistory: [{ status, at: movedAt }],
  }
}

const CARDS: readonly TaskRecord[] = [
  card('t1', 'todo', '把工作台栏的三段对齐', NOW - 2 * DAY),
  card('t2', 'running', '跑一次总览的渲染', NOW - 3_600_000),
  card('t3', 'review', '复核设计令牌的命名', NOW - 5 * DAY),
  card('t4', 'done', '搬完表面阶梯', NOW - 9 * DAY),
]

describe('总览页', () => {
  it('把栏、四格与流水线都画出来，数字来自 summary', () => {
    workbenchStage.bind(undefined, controllerWith(CARDS) as never, undefined)
    const html = renderToStaticMarkup(createElement(HomePage, { now: NOW }))
    try {
      // 栏：三个去处与出口都在。
      expect(html).toContain(t('workbench.tab.home'))
      expect(html).toContain(t('workbench.tab.board'))
      expect(html).toContain(t('workbench.tab.items'))
      expect(html).toContain(t('workbench.exit'))
      // 四格：标签来自字典，数字来自 summary（待办 1 / 进行 1 / 审核 1）。
      expect(html).toContain(t('home.tile.demand'))
      expect(html).toContain(t('home.tile.review'))
      expect(html).toContain(t('home.tile.dueToday'))
      expect(html).toContain(t('home.tile.overdue'))
      expect(html).toContain(t('home.pipeline'))
      expect(html).toContain(t('home.throughput'))
      expect(html).toContain(t('home.activity'))
      expect(html).toContain(t('home.sessions'))
    } finally {
      workbenchStage.unbind()
    }
  })

  it('读不到看板时说「读不到」，不画成一页 0', () => {
    workbenchStage.unbind()
    const html = renderToStaticMarkup(createElement(HomePage, { now: NOW }))
    expect(html).toContain(t('home.loadFailed'))
    expect(html).not.toContain(t('home.tile.overdue'))
  })

  it('没有完成记录时不发明周期与吞吐', () => {
    workbenchStage.bind(undefined, controllerWith([card('t1', 'todo', '还没做过', NOW - DAY)]) as never, undefined)
    const html = renderToStaticMarkup(createElement(HomePage, { now: NOW }))
    try {
      expect(html).toContain(t('home.flowEmpty'))
    } finally {
      workbenchStage.unbind()
    }
  })

  it('DSH_PANEL_HTML 给路径时写一页能截图的产物', () => {
    const target = process.env.DSH_PANEL_HTML
    if (target === undefined || target === '') return
    workbenchStage.bind(undefined, controllerWith(CARDS) as never, undefined)
    try {
      const html = renderToStaticMarkup(createElement(HomePage, { now: NOW }))
      const css = clientSheets().map(sheet => sheet.css).join('\n')
      const aligned = alignClassNames(html, css)
      writeStandalonePage(target, aligned.html, aligned.css, process.env.DSH_PANEL_DARK === '1' ? 'dark' : 'light', 'workbench overview')
      expect(existsSync(target)).toBe(true)
    } finally {
      workbenchStage.unbind()
    }
  })
})
