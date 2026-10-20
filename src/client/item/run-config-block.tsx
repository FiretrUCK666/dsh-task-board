/**
 * 「运行配置」那一块：清单详情右栏用的就是它（批量条上也用同一个）。
 *
 * ── 三条判据 ─────────────────────────────────────────────────────────────────
 *
 * 1. **读用看板那五行、写用看板那五个下拉**（`RunConfigRows` / `RunConfigFields`）：
 *    运行配置只有一份实现，清单这边不许长出第二套观感。
 * 2. **清单不存运行配置**：它属于**会跑起来的东西**，那是卡的事。挂着卡的行显示的是**那张卡的**
 *    配置（改也改那张卡）；没挂卡的行显示的是**这一次要交给它的那一份**——它是一份**设备本地
 *    草稿**（`drafts.ts`，与评论草稿同一条律：未提交回来、提交清槽），卡一出生就长在卡上。
 * 3. **答不了的那件事要说出来**：没挂卡时多一句实话（这一份会跟着新卡走），挂着卡时不加话
 *    ——同一句在两张卡上说两遍就是第二句关于卡的话。
 *
 * 它自己不判断「有没有卡」：`config` / `summary` / `note` / `onSave` 由面板那一层给，理由与
 * 「五个动作传进去而不是查出来」同一条——这一格不该知道看板控制器之外还有什么。
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import type { RunConfigPresetConfig } from '../../core/run-presets.ts'
import { t } from '../locales.ts'
import { Button, Disclosure } from '../design/ui.tsx'
import { RunConfigFields } from '../board/RunConfigFields.tsx'
import { RunConfigRows } from '../board/RunConfigRows.tsx'
import { NoteEntry, useNote } from './group-head.tsx'
import css from './item.module.css'

interface RunConfigBlockProps {
  /** 这一刻要显示的那份配置（卡上的，或这一次要用的草稿）。 */
  readonly config: RunConfigPresetConfig
  /** 折叠头上那一句：这一份是「默认设置」还是「已指定 N 项」。 */
  readonly summary: string
  /** 只在没挂卡时给的一句话（这一份要跟到哪儿去）。 */
  readonly note?: string | undefined
  readonly controller: BoardController
  /** 工作区那一行显示成什么名字；缺席就照 id 写。 */
  readonly workspaceTitleOf?: ((workspaceId: string) => string) | undefined
  /** 读者按「保存」时把整份配置交给谁（写卡，或写草稿）。 */
  readonly onSave: (next: RunConfigPresetConfig) => void
}

/**
 * The block.
 * @param props - what it shows, and where a saved value goes.
 * @returns the disclosure with the five rows, the editor behind 改, and the note.
 */
export function RunConfigBlock(props: RunConfigBlockProps) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  /* **草稿在这一层，不在编辑器里**：编辑器是被挂上/摘下的一格，读者没按「保存」就关掉它时，
   * 下一次打开必须是**屏上那一份**（卡上的或草稿里的），不是他上一次没保存的那份改动。 */
  const [draft, setDraft] = useState<RunConfigPresetConfig>(props.config)
  const startEdit = (): void => {
    setDraft(props.config)
    setEditing(true)
    setOpen(true)
  }
  const commit = (): void => {
    props.onSave(draft)
    setEditing(false)
  }
  /* **那句话的入口站在头行的末尾**，不常驻在块底下：它说的是这一份配置的命运，而命运不是读者
   * 每次看这一块都要读的一行字——它是读者**问出来之后**才有用的话（「还没挂卡，那我改的这一份
   * 算谁的」）。入口是一枚真按钮，所以触屏够得着（硬性规范 11③）。 */
  const note = useNote(t('item.ask.configWhy'))
  const headed = props.note !== undefined
  return (
    <div className={css.itemRunConfigHead} data-note={headed && note.open ? '' : undefined}>
      {/* **按钮不装按钮**：`Disclosure` 的头本身就是 `<button>`，所以 ⓘ 站在它旁边，两者由这一
       * 行承载。`data-note-hover` 挂在这一行上——读者指着的是「运行配置」这一行。
       *
       * **这一行不套盒子。** 包一层盒子时，ⓘ 的同行就是那一整块（头 + 展开的正文）——展开
       * 之后它会被摆到正文中间去。所以头那一行与折叠体各自是这一行里的一格（样式表那条网格
       * 规则），中间只隔着 `Disclosure` 自己那两层不画的盒子。 */}
      <div className={css.itemRunConfigHeadRow} data-note-hover="">
        <Disclosure
          title={t('item.ask.configRow')}
          summary={props.summary}
          open={open}
          onToggle={() => { setOpen(!open) }}
        >
          <RunConfigRows config={props.config} workspaceTitleOf={props.workspaceTitleOf} />
          {editing
            ? (
              <div className={css.itemRunConfigEdit}>
                <RunConfigFields value={draft} onChange={setDraft} controller={props.controller} />
                <div className={css.itemRunConfigAct}>
                  <Button size="sm" onClick={() => { setEditing(false) }}>{t('detail.cancel')}</Button>
                  <Button size="sm" variant="primary" onClick={commit}>{t('detail.save')}</Button>
                </div>
              </div>
            )
            : (
              <div className={css.itemRunConfigAct}>
                <Button size="sm" onClick={startEdit}>{t('item.ask.configChange')}</Button>
              </div>
            )}
        </Disclosure>
        {headed && <NoteEntry note={note} />}
      </div>
      {/* 只在还没挂卡时说：那时这一份会被新卡带走；已经挂着卡时说了就是第二句关于卡的话。 */}
      {headed && <p className={css.itemNote} id={note.id}>{props.note}</p>}
    </div>
  )
}
