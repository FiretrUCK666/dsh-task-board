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
 *
 * AND THE SEARCH BOX IS LIVE HERE, because the header draws it on every page.
 * It used to be a box that only the list page answered to: the reader typed
 * 「登录」 on the inbox, the rows did not move, and the header's own count DID
 * change — so 「the filter is working」 and 「the filter is ignored」 looked exactly
 * the same, which is the one thing the panel's own rule about degraded states
 * exists to prevent. Two filters, one of them a decoration, is the defect; the
 * page has no chrome of its own, but it does have a filter the reader can see.
 */
import { isInboxItem, itemMatches } from '../../../core/item-view.ts'
import { t } from '../../locales.ts'
import { useMemo } from 'react'
import type { ItemPageProps } from './page-props.ts'
import css from '../item.module.css'

export function InboxPage(props: ItemPageProps) {
  const { items, query, matchCtx } = props
  // Membership AND the filter, in that order: which rows are unfiled is a fact
  // about the document, and which of those the reader asked for is a fact about
  // the box. Reading the matcher from `core` rather than filtering the string
  // again here is the same discipline as reading `isInboxItem`.
  const rows = useMemo(
    () => items.filter(item => isInboxItem(item) && itemMatches(item, query, matchCtx)),
    [items, query, matchCtx],
  )
  const nothingToShow = props.filtering ? t('item.noMatch') : t('item.empty')
  return (
    <>
      <p className={css.itemInboxNote}>{t('item.inbox.note')}</p>
      <div className={css.itemInboxList}>
        {rows.length === 0
          ? <p className={css.itemState}>{nothingToShow}</p>
          : <ul className={css.itemList}>{props.renderRows(rows, false)}</ul>}
      </div>
    </>
  )
}
