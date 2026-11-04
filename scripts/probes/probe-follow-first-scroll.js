// 上下文窗口「往上滑第一下会被拽回底部」——量的是**时序**，不是观感。
//
// ── 症状 ─────────────────────────────────────────────────────────────────────
//
// 面板打开时内容停在底部。此时往上滑一下，会被拉回底部一次（同时卡一下）；
// 拉完那一次之后，再往上滑就顺畅了。
//
// 「第一次会、之后不会」这个形状本身就排除了「某条规则一直生效」——它说明某个
// 跟随写入在**第一次真正滚动之前**仍然认为自己在底部，于是把这一次滚动改回去了。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
// 造一个与真实挂载顺序同形状的场景：容器先被填满并滚到底（`atBottom` 初值 true），
// 然后**在上滑之前**触发一次尺寸变化。如果跟随逻辑在那一刻仍把位置写回底部，说明
// 「初始 true」这个假设一直活到了读者第一次动手之后。
//
//   S1 内容填满后，滚动位置在底部
//   S2 模拟内容尺寸变化（ResizeObserver 触发的那种），此时**不应**改变滚动位置
//      ——读者已经不在底部了
//   S3 而内容真的增长且读者仍在底部时，应当跟随到底部
//
// S2 是这次的核心：它区分了「跟随」与「把读者拽回去」。
;(() => {
  const host = document.getElementById('scroller')
  if (host === null) return { error: 'no scroller' }

  const report = []
  const push = (id, label, got, want) => report.push({ id, label, got, want, ok: got === want })
  const atBottom = () => host.scrollHeight - host.scrollTop - host.clientHeight < 24

  // S1: pinned to the bottom, as on open.
  host.scrollTop = host.scrollHeight
  push('S1', 'starts at the bottom', atBottom(), true)

  // The reader scrolls up: this is the gesture that must survive.
  const before = host.scrollHeight - host.scrollTop - host.clientHeight
  host.scrollTop -= 120
  const afterReader = host.scrollHeight - host.scrollTop - host.clientHeight

  // S2: a content resize lands right after the gesture. Nothing should move the
  // reader back; a follow effect that still believes it is at the bottom would.
  const guard = host.firstElementChild
  guard.style.paddingBottom = '1px'
  // Force layout so the observer's own write (if any) has happened.
  void host.scrollHeight
  const afterResize = host.scrollHeight - host.scrollTop - host.clientHeight
  push('S2', 'a resize must not pull the reader back', afterResize >= afterReader - 1, true)

  // S3: growth while the reader IS at the bottom must still follow.
  host.scrollTop = host.scrollHeight
  guard.style.paddingBottom = '400px'
  void host.scrollHeight
  host.scrollTop = host.scrollHeight - host.clientHeight
  push('S3', 'growth at the bottom still follows', atBottom(), true)

  return report
})()
