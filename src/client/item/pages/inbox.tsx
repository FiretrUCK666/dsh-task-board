/**
 * The inbox: thoughts that have not been filed yet, and nothing else.
 *
 * WHY THIS PAGE HAS NO CHROME. No filter bar, no ordering control, no group
 * heads, no batch bar, no overview strip. A note written thirty seconds ago is
 * read once, top to bottom, and everything that would help you ORGANISE it is one
 * step too early for that: a grouping control on a page whose whole content is
 * one unwritten decision teaches the reader that the page is where decisions get
 * made, and it is not. The rail keeps its number, because the rail is the map of
 * the surface rather than a control on this page — taking it away would turn
 * three named places into three words with no weight.
 *
 * The membership predicate is READ, never restated: `isInboxItem` is the model's,
 * and it is also what exempts a row from the triage strip's 「no date」 line, so a
 * copy here would be a second answer to a question two surfaces already share.
 */
import { isInboxItem } from '../../../core/item-view.ts'
import { t } from '../../locales.ts'
import { useMemo } from 'react'
import type { ItemPageProps } from './page-props.ts'
import css from '../item.module.css'

export function InboxPage(props: ItemPageProps) {
  const { items } = props
  const rows = useMemo(() => items.filter(isInboxItem), [items])
  return (
    <>
      <p className={css.itemInboxNote}>{t('item.inbox.note')}</p>
      <div className={css.itemInboxList}>
        {rows.length === 0
          ? <p className={css.itemState}>{t('item.empty')}</p>
          : <ul className={css.itemList}>{props.renderRows(rows)}</ul>}
      </div>
    </>
  )
}
