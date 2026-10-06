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
import { ItemTable } from '../item-table.tsx'

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
      {/* The same TABLE as the list page, with the pickbox column empty: the inbox
          has no batch surface, so `picking` is `false` and a row must not offer a
          tick that leads nowhere.

          AND NO SENTENCE ABOVE IT. This page used to open with 「收件只放还没分流的
          想法。给它一个优先级、一个日期、一个标签或一张卡，它就自己离开了。」 — a
          paragraph of instructions for a page whose entire content is one unwritten
          decision. The rail's 「刚记下的」 row is the map and it says the same thing
          in three characters; a page that explains itself before showing anything
          makes the reader read instead of look. **这一页不需要说它是什么，它只需要
          是它。** */}
      <ItemTable
        rows={props.renderRows(rows, false)}
        empty={nothingToShow}
        noMatch={props.filtering ? nothingToShow : undefined}
        now={props.now}
        sort={props.sort}
      />
    </>
  )
}
