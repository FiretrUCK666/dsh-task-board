/**
 * 「跳到某一条」 — decided, not performed.
 *
 * ── WHY THIS IS A CORE FUNCTION AND NOT A PANEL CALLBACK ────────────────────
 *
 * Page and focus ARE the panel's own local state, and that half stays there: what
 * a callback cannot carry is the judgment, which would be left where the coverage
 * gate cannot see it, the model cannot reach it, and the answer to 「#12 在哪一页」
 * exists in a React component instead of next to the predicates that decide which
 * page a row belongs to.
 *
 * So the panel gets the mechanism and core keeps the judgment: **which page
 * holds this row is a fact about the document**, already answered by
 * {@link isInboxItem} and {@link isAgendaItem}, and this function is where those
 * two are read together so the answer is written down once. A surface that wants
 * to jump somewhere asks this and then moves.
 *
 * ── WHY THE PAGE SET IS NOT AN ARGUMENT ─────────────────────────────────────
 *
 * The pages are a product constant ({@link ITEM_PAGES}), not a choice this
 * function offers. Naming another page here would create another place to keep
 * it consistent — which is the defect this file exists to remove.
 */
import type { ItemRecord } from './item.ts'
import { isAgendaItem } from './item-membership.ts'

/**
 * The panel's two pages, in reading order.
 *
 * A page is a QUESTION ("what is on me", "what is on me today"), not a layout.
 * Layouts are a property of a page, and a surface that grows one page per layout
 * ends up with a navigation strip nobody reads — so the set is closed here, in
 * data, and nothing in the interface may add a third.
 *
 * 收件 IS NOT A PAGE: 「还没分流的」 is a PREDICATE over the same
 * document (`isInboxItem`), read where a predicate belongs — by the query
 * grammar (`has:undated`'s exemption) and by the rail, through `isAgendaItem`.
 * A page whose whole existence is one rail row is a layout, not a question.
 *
 * **页码表与「跳到哪一页」是同一件事**，所以两者同住一处：一份只剩一张常量表、
 * 而读它的人按自己的顺序再写一遍的判断，是给下一个读代码的人留一个假线索。
 */
export const ITEM_PAGES = ['list', 'schedule'] as const
export type ItemPageId = typeof ITEM_PAGES[number]

/**
 * 一条清单条目的**短号**，按人说话的样子读回来。
 *
 * ── 为什么这是一处实现 ──────────────────────────────────────────────────────
 *
 * 短号是**说出来**的（`#12`），不是**写下来**的（`12`）。所以读它的地方都要先
 * 把那句「说出来的话」剥成数字——而这一句剥法曾经被抄了十份，其中**六份少了
 * 一个 `.trim()`**。
 *
 * 后果不是报错，是**同一个动作族给出两个答案**：`# 12`（带一个空格）在
 * `item.restore` / `item.purge` 找得到，在 `item.update` 找不到——同一行、同一
 * 个模型、同一个短号。读代码的人看不出差别，因为两处写的是同一个意思的两份
 * 拷贝。
 *
 * 所以这一处的规矩是：**唯一一处把「说出的话」剥成数字的地方**，其余全部导入它。
 * 它也只做这一件事——不判断这个短号存不存在（那是读文档那一处的活）。
 *
 * @param spoken - 说出／写下的那个短号（`#12`、`# 12`、`12`、或一个 uuid）。
 * @returns 剥掉 `#` 与首尾空白后的字符串；什么都不是时是空串。
 */
export function refOf(spoken: unknown): string {
  return String(spoken ?? '').replace('#', '').trim()
}

export type ItemNavigationRefusal = 'nothingAsked' | 'noSuchItem'

export type ItemNavigation =
  | { readonly kind: 'refused'; readonly why: ItemNavigationRefusal }
  | {
    readonly kind: 'go'
    readonly page: ItemPageId
    /** The row to focus, or `undefined` when only the page was asked for. */
    readonly ref: number | undefined
  }

/**
 * Which page holds this row.
 *
 * 清单 与 日程 are two readings of ONE document, and the answer is which reading a
 * jump should land in: a row with a date to work from is on 日程 (that page is the
 * day sequence), and everything else — including a bare capture and every finished
 * row — stays in 清单, because that page counts what EXISTS rather than what is
 * outstanding. Reading it the other way round is how a finished row ends up on a
 * page that does not list finished rows.
 *
 * A BARE CAPTURE STAYS IN 清单, like every other row: 收件 is not a page — it is a
 * reading of the same document with one door (its rail row) — and the predicate
 * behind it lives in the grammar where a predicate belongs. 清单 is also where the
 * reader already is.
 */
export function itemPageOf(item: ItemRecord): ItemPageId {
  return isAgendaItem(item) ? 'schedule' : 'list'
}

/**
 * Where a 「jump to this」 should land.
 *
 * @param input.page - the page asked for, if the caller named one.
 * @param input.of - the short number asked for, if any.
 * @param input.items - the document, for the case where only the row was named.
 * @returns the page and the row to focus, or the refusal. A refusal is always a
 *   shape, never a silent no-op: a jump that quietly does nothing reads as a
 *   broken button.
 */
export function planItemNavigation(input: {
  readonly page?: ItemPageId
  readonly of?: number
  readonly items: readonly ItemRecord[]
}): ItemNavigation {
  const { page, of, items } = input
  if (page === undefined && of === undefined) return { kind: 'refused', why: 'nothingAsked' }
  // Only the row was named: the page is a fact about the row, and answering it
  // here is the whole reason this function exists.
  if (page === undefined) {
    const found = items.find(item => item.ref === of)
    if (found === undefined) return { kind: 'refused', why: 'noSuchItem' }
    return { kind: 'go', page: itemPageOf(found), ref: found.ref }
  }
  if (of === undefined) return { kind: 'go', page, ref: undefined }
  // Both were named. The page is taken at the reader's word even when the row is
  // not on it — 「我要看清单这一页，并且把 #12 选上」 is a request with two parts,
  // and quietly moving them to the page the row lives on would answer a
  // different question.
  return { kind: 'go', page, ref: of }
}