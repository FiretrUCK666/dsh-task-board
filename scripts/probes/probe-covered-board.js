// 真页、真 React、真 hook：量「被盖住的那一层还重不重算」。
//
// ── 为什么这支探针必须存在 ────────────────────────────────────────────────────
//
// `tests/cover.spec.ts` 证明的是**契约**：登记表只有一个入口、读取者同步、三个壳都登记。
// 它证明不了「真 React 里，一条通知到底有没有穿过那层订阅」——那是 `useSyncExternalStore`
// 与 `subscribe` 的真实时序，jsdom 里看得见提交，看不见「订阅者到底收没收到」。
//
// 所以这一页把**同一份** `useBoardSnapshot` / `useCovered` / `useCover` 打进真页，然后发真
// 通知，问三个问题：
//
//   C1 没有浮层时，一条通知让看板那一层重画 **+1**（这是改前花钱的证据）
//   C2 浮层打开时，同样三条通知让重画次数**一动不动**，而 `covered` 读作真
//   C3 撤掉浮层时，画出来的是**最新**那一版（揭开补读了一次），`covered` 读作假
//
// C1 与 C2 必须同时成立：只有 C2 很容易（订阅断了就行），只有 C1 就说明改前确实在花钱。
// C3 是「停在正确的地方」那一半——少了它，读者关掉面板会看到一份旧数据。
//
// ── 怎么跑 ───────────────────────────────────────────────────────────────────
//
//   node scripts/probes/probe-covered-board.cjs
//   node scripts/shot-panel.mjs --url file:///<cwd>/tmp/covered-board.html \
//     --eval-file scripts/probes/probe-covered-board.js --width 900 --height 600 \
//     --audit --out tmp/covered-board.png
//
// 造页在 `.cjs` 里（node 端要写文件、要打包），量页在这里（Chromium 端只读 DOM）。
;(() => {
  const page = window.__probe
  if (page === undefined) {
    return { error: 'the live page did not expose its harness — did the bundle load?' }
  }

  const nextFrame = () => new Promise(done => requestAnimationFrame(() => { done() }))
  /** Let React commit AND let the effects that follow it run. */
  const settle = async () => {
    await nextFrame()
    await nextFrame()
  }

  return (async () => {
    await settle()

    const start = page.draws()

    // ── C1: nothing is open, so a notification must reach the board ────────────
    page.notify()
    await settle()
    const afterOneNotice = page.draws()

    // ── C2: the overlay opens; the board must stop accepting snapshots ─────────
    page.openOverlay()
    await settle()
    /* The reading is taken WHILE IT IS OPEN — asking later would photograph the
       state after the close and call it 「during」. */
    const coveredWhileOpen = page.coveredNow()
    const afterOpen = page.draws()
    for (let i = 0; i < 3; i += 1) {
      page.notify()
      await settle()
    }
    const afterCoveredNotices = page.draws()

    // ── C3: closing re-reads once, so the board shows the LATEST revision ─────
    page.closeOverlay()
    await settle()
    const afterClose = page.draws()
    const coveredAfterClose = page.coveredNow()
    const shownRevision = page.shownRevision()
    const latestRevision = page.revision()

    return {
      /* C1 —— 改前每次通知都重画，这是它花钱的证据。 */
      redrawsForOneNoticeWhileVisible: afterOneNotice - start,
      /* C2 —— 盖住期间三条通知，重画 0 次。 */
      redrawsForThreeNoticesWhileCovered: afterCoveredNotices - afterOpen,
      /* C3 —— 揭开后画的是最新那一版。 */
      redrawsOnReveal: afterClose - afterCoveredNotices,
      coveredWhileOpen,
      coveredAfterClose,
      shownRevisionOnReveal: shownRevision,
      latestRevision,
      pass:
        coveredWhileOpen === true
        && coveredAfterClose === false
        && afterOneNotice - start === 1
        && afterCoveredNotices - afterOpen === 0
        && shownRevision === latestRevision,
    }
  })()
})()
