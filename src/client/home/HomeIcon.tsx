/**
 * 工作台总览在 shell 面板列表里的那一行。
 *
 * 与看板、清单、设计系统三行同一个形状：shell owns 整行（按钮、几何、悬停/选中底色、
 * 宽栏里的名字、收起成图标栏时只剩图标），并自己调 `ctx.layout.selectPanel(<id>)`。
 * 这个组件贡献一枚图标，外加 shell 没有的那一个行为：它的 `selectPanel` 只会**打开**
 * 面板，所以在这一行已经选中时再按一下必须变成 `selectPanel(null)`——点进去，再点出来。
 *
 * 图是一枚表盘：指针停在偏右的刻度上。看板是分栏的方块、清单是三行勾选、设计系统是
 * 一排色块——「一眼看过去」这个意思由指针自己说，不和它们抢形状。
 *
 * 这一行注册用的 id 必须等于总览面板注册的 `main` key（shell 靠 id 把行解析到舞台），
 * 所以值从 `register.tsx` 的 `HOME_GROUP` 来，不在这里另写一遍。
 */
import { useRef } from 'react'
import { usePanelRowExit } from '../design/use-panel-row-exit.ts'
import css from '../board.module.css'

/** shell 给面板列表项绑定的 props。 */
export interface HomeIconProps {
  /** 请求的方形边长（宽栏与图标栏两档由 shell 决定）。 */
  size: number
  /** 这一面板是否正显示在主栏里。 */
  active: boolean
  /**
   * 离开总览（选回对话）。由注册方注入——它握着唯一那条出口，与「回到对话」同一个
   * `selectPanel(null)` 漏斗，所以「离开」在两个面板上不可能有两种意思。
   * 缺席 = 纯图标：不挂监听、不做切换，这一行仍然能把面板打开。
   */
  onExit?: () => void
}

/**
 * 画出总览的图标；面板开着时把它接成「再按一下即离开」。
 * @param props - shell 给的图标份额，加上注入的出口。
 * @returns 图标元素。
 */
export function HomeIcon({ size, active, onExit }: HomeIconProps) {
  const rootRef = useRef<SVGSVGElement>(null)
  usePanelRowExit(rootRef, active, onExit)
  return (
    <svg
      ref={rootRef}
      className={css.panelIcon}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 半圈刻度 + 一根指针：一块表盘，读作「现在的读数」。 */}
      <path d="M2.7 11.6a5.3 5.3 0 0 1 10.6 0" />
      <path d="M8 11.6 10.8 8.4" />
    </svg>
  )
}
