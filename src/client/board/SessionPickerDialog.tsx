/**
 * 会话选择器——两个入口共用**同一个**面板：任务详情里的「添加会话」，以及
 * 看板上的「会话建卡」。两处只有一件事不同：提交之后做什么（挂到已有的卡片
 * 上 / 造一张新卡片）。名单、筛选、分组、折叠、多选、页脚全是这一份，所以
 * 规则改一次两处同时生效，不可能再出现「卡片那边过滤了、看板那边没过滤」。
 *
 * 名单规则不在这里——见 {@link offerableSessionGroups}（子代理 / 空白槽 /
 * 归档的排除，工作区归属账本，末尾的未分组组）。本组件只做三件事：
 * 把规则给的分组画出来、记住选了哪些、把选中的 id 交回给调用方。
 *
 * 几条刻意为之的行为：
 * - **默认全折叠**，点开某个工作区才列出它的会话（几百上千个会话摊平在
 *   一列里是没法扫的）。
 * - **有搜索词时命中组自动展开**。否则「输了字什么都没发生」——搜索必须
 *   看得见自己找到了东西。
 * - **选择按 id 保持**，不随折叠或换关键词丢失；页脚计数始终是真实选中数。
 * - **提交的是「选中 ∩ 此刻面板里还在的」**。面板开着时被归档的会话会让
 *   计数与实际提交自动对齐，不会绑一个当下无效的来源。
 * - **没有全局条数上限**。旧的 `.slice(0, 50)` 会静默吞掉整组工作区（本项目
 *   的 no-silent-drop 律）；面板本来就滚动，一行不少地列全。
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { UNGROUPED_KEY, type SessionGroup } from '../../core/session-groups.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Dialog } from './Dialog.tsx'
import { Button, Disclosure, Icon } from './ui.tsx'

/** One picker's props. The two callers differ ONLY in `exclude` / `onSubmit`. */
export function SessionPickerDialog({ controller, exclude, title, submitLabel, onSubmit, onClose }: {
  controller: BoardController
  /** Sessions this surface must not offer (the card's own related set);
   *  undefined at the board level, where nothing is bound yet. */
  exclude?: ReadonlySet<string>
  title: string
  submitLabel: string
  onSubmit: (sessionIds: readonly string[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  // Explicitly opened groups (by workspace key). Absent = collapsed, which is
  // the state the picker opens in.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  // Selection is by session id, so it survives folding and re-searching.
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())

  // Fresh on every render, on purpose: the groups are the derivation's answer
  // over two LIVE native snapshots, and this panel re-renders on every
  // controller notify — so a session archived or created elsewhere is in or
  // out of the list within the same tick. Caching either input is exactly how
  // a picker ends up offering something it can no longer bind.
  const all = controller.offerableSessionGroups(exclude)
  const needle = query.trim().toLowerCase()
  const groups = needle === '' ? all : all
    .map(group => ({
      ...group,
      sessions: group.sessions.filter(session =>
        session.title.toLowerCase().includes(needle) || session.sessionId.toLowerCase().includes(needle)),
    }))
    .filter(group => group.sessions.length > 0)

  // What a submit actually commits: the ids this panel is still offering, so a
  // session that left the list (archived) mid-picker is never bound.
  const offered = new Set(groups.flatMap(group => group.sessions.map(session => session.sessionId)))
  const chosen = [...picked].filter(id => offered.has(id))
  const toggle = (sessionId: string): void => {
    setPicked(previous => {
      const next = new Set(previous)
      if (!next.delete(sessionId)) next.add(sessionId)
      return next
    })
  }
  const toggleGroup = (key: string): void => {
    setOpened(previous => {
      const next = new Set(previous)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  return (
    <Dialog title={title} label={title} onClose={onClose} portal>
      <div className={css.modalScroll}>
        <input
          className={css.input}
          type="search"
          value={query}
          placeholder={t('detail.addSessionSearch')}
          aria-label={t('detail.addSessionSearch')}
          onChange={event => { setQuery(event.target.value) }}
        />
        {groups.length === 0 ? (
          <p className={css.detailText}>
            {all.length === 0 ? t('detail.addSessionEmpty') : t('detail.addSessionNoMatch')}
          </p>
        ) : (
          groups.map(group => (
            <PickerGroup
              key={group.key}
              group={group}
              // A search expands whatever it found: the search must show its
              // own hits, or typing looks broken. No query = the collapsed
              // default the picker opens as.
              open={needle !== '' || opened.has(group.key)}
              onToggle={() => { toggleGroup(group.key) }}
              picked={picked}
              onToggleSession={toggle}
            />
          ))
        )}
      </div>
      <footer className={css.modalFooter}>
        {/* The count owns the free space (flex), so the actions sit right
            WITHOUT a `margin-left:auto` — auto margins right-align whichever
            item happens to start a wrapped line, which is the banned
            spelling board-wide. */}
        <span className={css.pickerCount} role="status">
          {t('detail.addSessionSelected', { n: String(chosen.length) })}
        </span>
        <Button onClick={onClose}>{t('new.cancel')}</Button>
        <Button
          type="button"
          variant="primary"
          disabled={chosen.length === 0}
          onClick={() => { onSubmit(chosen) }}
        >
          {submitLabel}
        </Button>
      </footer>
    </Dialog>
  )
}

/** One foldable workspace section. Disclosure is the board's ONE fold grammar
 *  (chevron + title + live summary, `aria-expanded` / `aria-controls` wired) —
 *  a second hand-rolled fold is how a chevron forgets to turn. */
function PickerGroup({ group, open, onToggle, picked, onToggleSession }: {
  group: SessionGroup
  open: boolean
  onToggle: () => void
  picked: ReadonlySet<string>
  onToggleSession: (sessionId: string) => void
}) {
  return (
    <Disclosure
      title={group.label}
      summary={t('detail.addSessionGroupCount', { n: String(group.sessions.length) })}
      open={open}
      onToggle={onToggle}
    >
      <ul className={css.addSessionList}>
        {group.sessions.map(session => {
          const on = picked.has(session.sessionId)
          return (
            <li key={session.sessionId}>
              <button
                type="button"
                className={css.addSessionRow}
                data-selected={on ? '' : undefined}
                aria-pressed={on}
                onClick={() => { onToggleSession(session.sessionId) }}
              >
                <Icon name={on ? 'check' : 'link'} className={css.sessionRowIcon} />
                <span className={css.addSessionLabel} title={session.sessionId}>{session.title}</span>
                {/* The folder label only earns its place in the UNGROUPED
                    group: inside a workspace group every row would repeat the
                    heading the group already says. */}
                {group.key === UNGROUPED_KEY && session.workspaceLabel !== undefined && (
                  <span className={css.addSessionFolder}>{session.workspaceLabel}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </Disclosure>
  )
}
