/**
 * 「交给 AI」那张小纸：**先看一眼它要用什么跑，再交出去**。
 *
 * ── 它修的是一处交互上的错 ────────────────────────────────────────────────────
 *
 * 早先按「问 AI」，没挂卡的那一条会**当场建一张卡并立刻开跑**——用的是部署默认或者读者
 * 设过的默认预设，而读者从头到尾没有机会看一眼「它要用哪个工作区、哪个模型、什么权限」。
 * 一份要花掉真实算力的工作不该在读者没点头的情况下按默认值启动；而「先建卡、再跑、事后再
 * 去详情里改配置」也不是一条路——**跑到一半的会话改配置已经晚了**。
 *
 * 所以这个手势变成两步：按「问 AI」→ 这张纸先开，配置**预填**（有卡就用卡上的，没卡就用
 * 默认预设链）→ 按「交给它」才真的建卡、写配置、发出去。
 *
 * ── 同一张纸，两个入口 ────────────────────────────────────────────────────────
 *
 * 详情右栏那一行「运行配置」的「改」开的也是它（`verb` 是 `save`）。一处实现两处用的理由
 * 与 `prose-field` / `AttachmentStrip` 同一条：两个入口各画一遍，改一处不报错——而它们说的
 * 是同一件事（这一次要用什么跑）。
 *
 * ── 它不自己算任何东西 ────────────────────────────────────────────────────────
 *
 * 卡片从哪来、提升怎么写、配置写进哪张卡、发出去的是哪段话：全在面板那一层（它才有控制器、
 * 预设存储与台账）。这一格只知道「读者选了这几个值，按了那枚按钮」。
 */
import { useRef } from 'react'
import type { BoardController } from '../../core/controller.ts'
import type { RunConfigPresetConfig } from '../../core/run-presets.ts'
import { t } from '../locales.ts'
import { Button } from '../board/ui.tsx'
import { RunConfigFields } from '../board/RunConfigFields.tsx'
import { CrossMark } from './marks.tsx'
import { useDialogFocus } from '../board/dialog-focus.ts'
import css from './item.module.css'

export interface AskSheetProps {
  readonly open: boolean
  readonly onClose: () => void
  /** `ask` = 交给它（存下配置并且马上发出去）；`save` = 只存下配置。 */
  readonly verb: 'ask' | 'save'
  /** 这一条自己的话要送出去什么（一行摘要，读者按之前能读到）。 */
  readonly summary: string
  readonly config: RunConfigPresetConfig
  readonly onConfig: (next: RunConfigPresetConfig) => void
  readonly controller: BoardController
  /** 那一次已经发出去、还没回来（按钮在这一刻禁用，免得连按两次）。 */
  readonly busy: boolean
  /** 主按钮那一下：`ask` 时是「建卡 / 写配置 / 发出去」，`save` 时是「写进那张卡」。 */
  readonly onSubmit: () => void
}

/**
 * The sheet.
 * @param props - whether it is open, which verb it carries, and what it will send.
 * @returns the overlay, or nothing.
 */
export function AskSheet(props: AskSheetProps) {
  const sheet = useRef<HTMLDivElement | null>(null)
  /* 焦点进得来、出得去：一枚自己声明 modal 的浮层若不接管焦点，键盘的下一次输入会落在
     读者看不见的地方；而关掉之后焦点要还给按它的那一枚（面板那一层负责还）。 */
  useDialogFocus(sheet, props.open ? 'ask' : undefined)
  const title = t(props.verb === 'ask' ? 'item.ask.sheetTitle' : 'item.ask.configTitle')
  if (!props.open) return null
  return (
    <div
      className={css.itemOverlayMask}
      onPointerDown={event => { if (event.target === event.currentTarget) props.onClose() }}
    >
      <div
        ref={sheet}
        className={css.itemAskSheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={event => {
          // ONE LAYER, ONE ESCAPE — the same rule the new-row sheet follows.
          if (event.key !== 'Escape') return
          event.stopPropagation()
          props.onClose()
        }}
      >
        <header className={css.itemCreateDialogHead}>
          <h2 className={css.itemCreateDialogTitle}>{title}</h2>
          <button
            type="button"
            className={css.itemCreateDialogClose}
            aria-label={t('item.sheet.close')}
            onClick={props.onClose}
          >
            <CrossMark size={14} />
          </button>
        </header>
        {/* **读者按之前先读到「要送出去的是什么」。** 一句话与它带的附件数是这一按的全部
            内容，而它在纸里写得下——送到模型那边之后，读者再想看一次就得去翻会话了。 */}
        <p className={css.itemAskWhat}>{props.summary}</p>
        <div className={css.itemAskBody}>
          <RunConfigFields
            value={props.config}
            onChange={props.onConfig}
            controller={props.controller}
          />
        </div>
        <footer className={css.itemCreateDialogFoot}>
          <Button onClick={props.onClose}>{t('detail.cancel')}</Button>
          <Button
            variant="primary"
            disabled={props.busy}
            onClick={() => { props.onSubmit() }}
          >
            {t(props.verb === 'ask' ? 'item.ask.submit' : 'item.ask.saveConfig')}
          </Button>
        </footer>
      </div>
    </div>
  )
}
