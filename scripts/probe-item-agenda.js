// Measures the agenda's ONE left edge: the section head (a pill), the note under
// it, the collapsed empty-days pill and the footer all have to start on the same
// vertical line as the first thing inside every row card — and the cards
// themselves sit one step further out.
//
// WHY IT IS ITS OWN PROBE. The rail's probe answers where the rail's chrome sits;
// this page's question is different, and it is the one the reader asked about
// (「小字压在壁纸上、和下面的行对不齐」). The number that matters is not one element's
// left edge: it is whether FOUR elements agree, so the probe reports all four plus
// the row card they must line up with.
//
// The last expression IS the answer: shot-panel evaluates this file and returns
// its completion value, so nothing here may end in `console.log`.
;(() => {
  const round = (value) => Math.round(value * 10) / 10
  const inkOf = (el) => {
    if (el === null) return null
    const range = document.createRange()
    range.selectNodeContents(el)
    const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
    if (rects.length === 0) return null
    return {
      l: round(Math.min(...rects.map(r => r.left))),
      r: round(Math.max(...rects.map(r => r.right))),
    }
  }
  const boxOf = (el) => {
    if (el === null) return null
    const r = el.getBoundingClientRect()
    return { l: round(r.left), r: round(r.right), w: round(r.width), h: round(r.height) }
  }
  const one = (sel) => document.querySelector(sel)
  const all = (sel) => [...document.querySelectorAll(sel)]

  /* 一个「让出左沿」的元素，屏幕上的左沿是**墨**：有底的那两枚（药丸）由 margin 让，
     没有底的那些由 padding 让——所以判据是 `ink.l`，不是 `box.l`（两者的差正是内衬）。
     量法：`Range.getClientRects()` 给墨，`getBoundingClientRect()` 给盒。 */
  const lead = (name, el) => {
    const box = boxOf(el)
    const ink = inkOf(el)
    const cs = el === null ? null : getComputedStyle(el)
    return {
      name,
      box: box === null ? null : box.l,
      ink: ink === null ? null : ink.l,
      // 有底的那两枚：底是不是从同一个数起（padding 会把底也推出去，所以它们是 margin）。
      paddingStart: cs === null ? null : cs.paddingInlineStart,
      marginStart: cs === null ? null : cs.marginInlineStart,
      background: cs === null ? null : (cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? null : 'filled'),
    }
  }

  /* **选择器读的是现行的名字。** 日程页曾经有 `.itemAgendaHead` / `.itemAgendaNote` /
     `.itemAgendaLeftOut` 三个类，它们都随「两个页面一枚组头」那一次改动删掉了——一个指着
     已删类名的探针会返回空数组，而那看起来和「量出来是 0」一模一样。
     现在：组头是 `.itemGroupHead`（两个页面共用）、说明是 `.itemNote`（平时 `display: none`，
     所以这里量不到它的墨——那正是它该有的样子）、页尾那件事并进了安静行（`.itemEmptyGroups`）。 */
  const heads = all('[class*="itemGroupHead"]')
  const notes = all('[class*="itemNote"]')
  const empty = one('[class*="itemEmptyGroups"]')
  const footer = one('[class*="itemEmptyGroups"]')
  const row = one('[class*="itemRow"]')
  const root = one('[class*="itemAgenda"]')

  /* 行里的第一个字：读者真正的参照物——节头要与它对齐，而**不是**与行卡的外沿对齐。 */
  const firstInk = (() => {
    if (row === null) return null
    const range = document.createRange()
    range.selectNodeContents(row)
    const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
    return rects.length === 0 ? null : round(Math.min(...rects.map(r => r.left)))
  })()

  return JSON.stringify({
    viewport: window.innerWidth,
    agendaLead: root === null ? null : getComputedStyle(root).getPropertyValue('--item-agenda-lead').trim(),
    head: lead('head', heads[0] ?? null),
    headsWord: heads.map(el => (el.textContent ?? '').trim().slice(0, 12)),
    note: lead('note', notes[0] ?? null),
    notes: notes.map(el => (el.textContent ?? '').trim().slice(0, 16)),
    empty: lead('empty', empty),
    footer: lead('footer', footer),
    rowCard: boxOf(row) === null ? null : boxOf(row).l,
    rowFirstInk: firstInk,
  })
})()
