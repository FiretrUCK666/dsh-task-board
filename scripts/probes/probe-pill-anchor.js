// 量三种摆法下，胶囊相对**滚动容器可见角**的位置。
//
// 判据只有一条：滚到中间与滚到底，胶囊都必须还在同一个角上（`topInBox` 恒定且留在可见
// 区内）。只测位置 0 是没用的——内容顶端与容器顶端重合，三种摆法在那里长得一模一样。
;(() => {
  const measure = (boxId, pillId) => {
    const box = document.getElementById(boxId)
    const pill = document.getElementById(pillId)
    if (box === null || pill === null) return { error: `${boxId}/${pillId} missing` }
    const at = (top) => {
      box.scrollTop = top
      const boxRect = box.getBoundingClientRect()
      const pillRect = pill.getBoundingClientRect()
      return {
        scrollTop: Math.round(box.scrollTop),
        topInBox: Math.round(pillRect.top - boxRect.top),
        rightInBox: Math.round(boxRect.right - pillRect.right),
        visible: pillRect.top >= boxRect.top - 1 && pillRect.bottom <= boxRect.bottom + 1,
      }
    }
    const max = box.scrollHeight - box.clientHeight
    return [at(0), at(Math.round(max / 2)), at(max)]
  }

  const rows = { a: measure('aBox', 'aPill'), b: measure('bBox', 'bPill'), c: measure('cBox', 'cPill') }
  const pinned = samples => Array.isArray(samples)
    && samples.every(one => one.topInBox === samples[0].topInBox && one.visible)
  return {
    A_absoluteInsidePositionedScroller: rows.a,
    B_absoluteOnFrameOutsideScroller: rows.b,
    C_absoluteInsideUnpositionedScroller: rows.c,
    pinned: { A: pinned(rows.a), B: pinned(rows.b), C: pinned(rows.c) },
    verdict: pinned(rows.b) && !pinned(rows.a)
      ? 'only the frame outside the scroller holds the corner'
      : 'unexpected — read the samples',
  }
})()
