/**
 * Review-page pure logic (domain grouping): the transcript folding + usage
 * sum, the context-meter arithmetic, the slash-menu flip judgment and the
 * session to-do readout — the pure helpers the review page / session panel
 * render from, tested together as one contract file.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { foldTurns, sumUsage, reasoningOf, type TranscriptEvent } from '../src/client/board/review-transcript.ts'
import { cacheHitRate, contextOccupancy, contextSegments, formatTokens, formatTps } from '../src/client/board/context-meter.ts'
import { shouldFlipMenuUp } from '../src/client/board/menu-direction.ts'
import { contextWorthOf, isOpenTodo, latestSessionTodos } from '../src/client/board/interaction.ts'
import { designCss, pageCss, ruleTextOf } from './panel-harness.ts'

/* 看板这一页可以有任意多张表——判据读的是**合计**，不是某一个文件名。 */
const cssSource = pageCss('board')

/**
 * The board sheet PLUS the design system's own sheet — "this surface as it
 * renders".
 *
 * The two are not interchangeable and the difference is the point:
 *
 *   - a BAN reads `cssSource` alone. "This surface must not declare X" is a
 *     claim about what THIS surface owns; scanning somebody else's sheet would
 *     make the ban fire on a rule the surface never wrote, and the cheapest way
 *     to pass would be to edit the design system.
 *   - a POSITIVE claim about a SHARED component reads `renderedSource`. The
 *     disclosure turn, the modal chrome and every other shared grammar live in
 *     `design/components.module.css` now, so a rule asserting that the shared
 *     component behaves must read where that component's rules actually are.
 */
const renderedSource = `${cssSource}\n${designCss()}`

/** Rule text with its comments removed. A ban reads CODE, not the prose that
 *  explains it — and this sheet documents its rules inside them, so a substring
 *  search without this step forbids the explanation along with the practice
 *  (硬性规范 14: a checker that cannot see context forces people to edit the
 *  right thing to please it). */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The first top-level `.name { … }` rule body (line-start match, trim-tolerant
 *  so indented @container rules are also findable). */
/** One class's own rule text, as THIS SURFACE renders it.
 *
 *  Reads 
enderedSource (board + design system) rather than the board sheet
 *  alone, because these assertions are about what an element gets when the
 *  review page renders — and half of what it gets now comes from the shared
 *  components' sheet. Board first, so at equal specificity the surface's own
 *  rule is the one found, which is also the cascade's precedence. */
function ruleOf(name: string): string {
  const found = ruleTextOf(renderedSource, `.${name}`)
  if (found === undefined) throw new Error(`rule ".${name}" not found in board.module.css`)
  return found
}

describe('rail layout CSS contract (interaction card never bursts the rail)', () => {
  it('the interaction card is shrinkable and sits on the rail content line', () => {
    const card = ruleOf('interactionCard')
    expect(card).toContain('min-width: 0')
    // The rail's ONE content line comes from the token (a member that re-types
    // 14px is how the rail grew a 28px row beside a 0px one).
    expect(card).toMatch(/margin:\s*0 var\(--dsh-tb-rail-inset\) 2px/)
  })

  it('HEIGHT LAW: the card is content — it never caps or clips itself, and the comments box is the region that scrolls', () => {
    const card = withoutComments(ruleOf('interactionCard'))
    // The card draws no cap and no clip of its own, and the two halves are the
    // SAME law: a capped card whose chrome is `flex: none` cannot survive a box
    // shorter than head+footer — `overflow: hidden` slices the pinned rows
    // instead of shrinking them. Measured at 412 (the narrow band, where the
    // folds block is capped): the comments box is 273px, a question with four
    // described options is 292px, and a 290px floor under the cap put the
    // card's own footer 29px BELOW its box — the reader met a card whose
    // 跳过/下一题 were sliced in half, while the card's inner scroller carried
    // `overscroll-behavior: contain` and so swallowed the gesture that would
    // have revealed them. Content has no such state.
    expect(card, 'the card grew a cap again: it is content, and the comments box is the scroller').not.toMatch(/max-height/)
    expect(card, 'the card clips its own chrome again').not.toMatch(/overflow:\s*hidden/)
    expect(card).not.toMatch(/\d+(vh|dvh|vw)\b/)
    // The bodies are plain content. A scroll region here would be a second,
    // smaller window onto the same text — and one whose `contain` traps the
    // gesture instead of chaining it out to the box that holds the card.
    for (const body of ['interactionBody', 'interactionCardBody']) {
      expect(withoutComments(ruleOf(body)), `.${body} must not be a scroll region of its own`).not.toMatch(/overflow(-y)?:\s*(auto|scroll|hidden)/)
      expect(withoutComments(ruleOf(body)), `.${body} must not trap the gesture it cannot chain`).not.toContain('overscroll-behavior')
    }
    // The POSITIVE half, so the bans above cannot be satisfied by the rules
    // simply going missing: the plan's body is the ONE reading window inside the
    // card (a plan is a document), the box is the region that scrolls, and the
    // footer is still the row at the card's end.
    expect(ruleOf('interactionPlanBody'), 'the plan body stopped being a reading window').toContain('overflow-y: auto')
    expect(ruleOf('commentsScroll'), 'the rail lost its scroller — nothing absorbs the card any more')
      .toMatch(/overflow-y:\s*auto/)
    expect(ruleOf('interactionFooter')).toContain('flex: none')
    // And the plan's window must CHAIN: a gesture that ends there has to keep
    // going into the box that holds the card, or the decision rows below look
    // unreachable from the one place the reader's finger already is. Read from
    // the rule body, never from the sheet as a whole — the prose that explains
    // the ban names the property (硬性规范 14).
    expect(withoutComments(ruleOf('interactionPlanBody')), 'the plan window traps the gesture again (overscroll-behavior: contain)')
      .not.toContain('overscroll-behavior')
    // 咬得动：把封顶、自裁与内滚写回去，上面的读法必须各报一次。种在测试里，不在 src 上做
    // 临时改动（硬性规范 16）——而且先剥注释再读（硬性规范 14）。
    expect(withoutComments('max-height: max(290px, min(320px, 100%));'), 'the cap ban did not bite').toMatch(/max-height/)
    expect(withoutComments('overflow: hidden;'), 'the clip ban did not bite').toMatch(/overflow:\s*hidden/)
    expect(withoutComments('.interactionBody { overflow-y: auto; }'), 'the scroll-region ban did not bite')
      .toMatch(/overflow(-y)?:\s*(auto|scroll|hidden)/)
    expect(withoutComments('/* an `overscroll-behavior: contain` note */ padding: 0;'), 'the trap ban did not bite on prose')
      .not.toContain('overscroll-behavior')
  })

  it('the rail never scrolls; EXACTLY ONE scrollport is live per tier', () => {
    // The rail is NOT a scroll container: a scrollport that contains the composer is
    // how the send box gets pushed out of reach, and a `display: contents` rail cannot
    // scroll at all (a declared-but-dead scroller is a lie the follow logic could walk
    // into).
    //
    // The assertion is the INVARIANT, not one way of expressing it. It used to read
    // `overflow: hidden` — and that literal is exactly what broke the panel: a box that
    // rounds AND clips sends every scrolling descendant to the main thread, so the
    // comments scroller took 90 of 90 wheel events on the main thread (see the note on
    // `.modal` in the shared sheet, and DESIGN.md's Shapes section for the method).
    // The rail is the band that reaches the panel's bottom-right corner, so it has to
    // round; therefore it must not clip. `visible` is not a scroller either, and the
    // folds block inside clips its own content.
    expect(ruleOf('reviewRail')).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/)
    expect(ruleOf('reviewRail'), 'the rail rounds, so it must not clip — that pair is what costs the scroller its thread')
      .not.toMatch(/overflow(-[xy])?:\s*(hidden|clip)/)
    expect(ruleOf('sessionRailFolds')).toMatch(/min-height:\s*0/)

    /* ONE LIVE PORT, NOT TWO.
     *
     * The folds block used to scroll at BOTH tiers while the comments region inside
     * it also scrolled. Two nested ports mean every gesture is hit-tested against
     * the inner one and then walked up the scroll chain — on the main thread, for
     * every wheel event. The comment surface was the only place that lagged, and
     * the board's columns (which have no nesting) never did.
     *
     * On the wide rail the comments region is the reading surface, so the outer
     * block must not scroll; on the narrow tier the comments start folded and the
     * folds block IS the surface, so it must. Both tiers have exactly one. */
    expect(ruleOf('sessionRailFolds'), 'the wide rail must not add a second scrollport').toMatch(/overflow-y:\s*hidden/)
    // Looser on purpose: the narrow block carries a comment explaining why it
    // restores the outer scroll, so anchoring on the first declaration after the
    // selector would pin prose rather than structure. The rule itself is read with
    // the shared rule reader, so its length is nobody's business.
    const narrowAt = renderedSource.indexOf('@container dsh-tb-panel (max-width: 600px)')
    expect(narrowAt, 'the narrow container query must exist').toBeGreaterThan(0)
    const narrowBlock = renderedSource.slice(narrowAt)
    const foldsAt = narrowBlock.indexOf('.sessionRailFolds {')
    expect(foldsAt, 'the narrow tier must name the folds block').toBeGreaterThan(0)
    expect(ruleTextOf(narrowBlock, '.sessionRailFolds') ?? '', 'the narrow tier restores the outer scroll')
      .toMatch(/overflow-y:\s*auto/)
  })

  it('action rows wrap instead of bursting the card right edge', () => {
    const actions = ruleOf('interactionActions')
    expect(actions).toContain('flex-wrap: wrap')
    // The interactive card's footer (pager ‖ reason ‖ skip + next/submit) is
    // the SAME graceful layer, and keeps the native status row for the reason
    // a submit was refused.
    expect(ruleOf('interactionFooter')).toContain('flex-wrap: wrap')
    expect(ruleOf('interactionFeedback')).toMatch(/min-height:\s*16px/)
  })

  it('a refused send SAYS SO, and its reason is not masked by an older one', () => {
    // The mechanism this pins: the steer branch must not restore the draft and
    // return, because a reader whose words reappear in the box sees nothing at
    // all — 「a refusal must speak; restoring the draft silently is how
    // 点了没反应 happens」.
    const code = readFileSync(fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // The old shape specifically: a one-line `then` that restores and stops.
    expect(code, 'the steer refusal still restores the draft silently, so the reader sees nothing happen')
      .not.toMatch(/void sent\.then\([^)]*=>\s*\{[^}]*if \(!ok\) restore\(\)/)
    // The other half asserted positively, because a `not.toMatch` alone is also
    // satisfied by the branch simply not existing — a passing test that has
    // stopped checking anything. The two halves together are what makes this a
    // check rather than a green light.
    expect(code, 'the steer refusal restores the draft but never says why')
      .toMatch(/if \(ok\) return[\s\S]{0,160}restore\(\)\s*\n\s*setSendError\(t\('review\.sendNotSent'\)\)/)
    expect(code, 'the send failure is masked by an older attachment error, so the reason shown is the wrong one')
      .not.toMatch(/attachments\.error \?\? sendError/)
    // The retry must clear the PREVIOUS refusal before it starts, or a refusal
    // that has been fixed stays on screen after a later send succeeds.
    expect(code, 'a previous refusal is never cleared, so it stays on screen after a later send succeeds')
      .toMatch(/setSendError\(undefined\)[\s\S]{0,200}void sent\.then/)
  })

  it('the session-rule switch refuses VISIBLY, and stays dis-armable', () => {
    // 「按了没反应」 IS the owner's standing complaint, and this switch is a live
    // instance of it: `toggleSessionRule` returns void and declines in two real
    // cases — the dead-arm law and an unparseable cron — so a switch that accepts
    // the press and springs back with nothing said is exactly the complaint. The
    // task-level schedule switch, in the same file, reports the identical fact as
    // `disabled` plus one line: two switches, one fact, so both must be honest.
    //
    // So the row is DISABLED WITH A STATED REASON rather than left live. The
    // condition is the controller's own: arming is blocked, but turning a dead arm
    // OFF never is — so the gate must be absent while the rule is on, or a rule
    // could never be disarmed and the gate would be a worse dead control than the
    // one it replaces.
    const code = readFileSync(fileURLToPath(new URL('../src/client/board/automation-ui.tsx', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code, 'the rule switch disables with no reason attached, so the reader is not told why')
      .toMatch(/disabled=\{armingBlocked\}/)
    expect(code, 'the disabled switch is not linked to its reason, so a screen reader never reads it')
      .toMatch(/describedBy=\{armingBlocked \? blockReasonId : undefined\}/)
    // The gate must be ARMING-only. Without `!row.enabled` a dead arm could never
    // be switched off.
    expect(code, 'the gate does not exempt the dis-arm direction, so a dead arm could never be turned off')
      .toMatch(/armingBlocked\s*=\s*!row\.enabled\s*&&\s*readiness\.kind\s*===\s*'blocked'/)
    expect(code, 'the switch is not driven by the readiness the controller refuses on')
      .toMatch(/sessionRuleReadiness\(task, sessionRuleOf\(row\)\)/)
  })

  it('a form that replaces its own trigger moves focus into itself', () => {
    // THREE SURFACES HAVE THIS SHAPE, so the gate belongs on the MECHANISM rather
    // than on each call site: three call sites checked three times is the
    // arrangement that lets the fourth one ship.
    //
    // A form that opens by REPLACING its trigger unmounts that trigger, so focus
    // falls to `document.body`. In a dialog that is worse than cosmetic: the Tab
    // trap is a keydown handler ON the panel, `document.body` is not the panel,
    // so the trap disarms and Tab walks out into the board behind. In a section
    // it means the reader opens a form and the caret is nowhere near it.
    //
    // The re-aim is ONE mechanism (`useFocusOnChange`, and `useDialogFocus`'s
    // `focusKey` for dialogs) — so the gate is on the mechanism, not on each call
    // site, because three call sites checked three times is the arrangement that
    // let the third one ship in the first place.
    const focus = readFileSync(fileURLToPath(new URL('../src/client/design/dialog-focus.ts', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(focus, 'the shared re-aim is gone, so a replacing form drops focus to the body again')
      .toContain('useFocusOnChange')
    // `Dialog` must actually pass it through, or the mechanism exists and nothing
    // can reach it — which is exactly how the first two call sites failed.
    const dialog = readFileSync(fileURLToPath(new URL('../src/client/design/Dialog.tsx', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(dialog, 'Dialog declares a focusKey but does not hand it to the hook')
      .toMatch(/useDialogFocus\(panelRef, focusKey\)/)
  })

  it('the interaction card carries the native question grammar, item by item', () => {
    // 与原生的提问卡逐条对齐是契约：同一批部件、同一套行为。这条 spec 把
    // 部件清单钉死，任何一处被删/改名都会红，避免再次退回「只有一个按钮」。
    const cardPath = fileURLToPath(new URL('../src/client/board/InteractionCard.tsx', import.meta.url))
    const card = readFileSync(cardPath, 'utf8')
    // Head: eyebrow + title + the collapse / dismiss-all pair.
    for (const part of ['interactionEyebrow', 'interactionTitle', 'interactionHead', 'interactionHeadActions']) {
      expect(card).toContain(`css.${part}`)
    }
    expect(card).toContain("t('review.interactionAbandon')")
    expect(card).toMatch(/t\(minimized \? 'review\.interactionExpand' : 'review\.interactionCollapse'\)/)
    // The dismiss-all press must ASK FIRST, and the reason it is worth a gate is
    // that this assertion's shape cannot see the question: the head's grammar is
    // checked with `toContain`, which a confirmation does not disturb — so reading
    // the un-guarded button as the contract would make adding the question look
    // like a regression.
    //
    // Abandoning is not 「hide a card」: it settles the host call as CANCELLED and
    // the agent proceeds WITHOUT the answers, and the answers already given are
    // stranded under an rpcId that is minted once and never re-published. A press
    // with no question spends the reader's chance to answer for it.
    // Every check below runs on the MARKUP, never on the prose. This gate got
    // that wrong first and matched its own comment — the note explaining the
    // abandon press contains the very `onClick` it was asserting was absent. A
    // checker that reads a comment as code is not checking anything, and the
    // cheapest way to make it green is to reword the comment, which is the exact
    // failure hard rule 14 is about.
    const code = card.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code, 'the dismiss-all press fires the cancel with no question').not.toMatch(/onClick=\{dismissAll\}/)
    expect(code, 'the abandon press does not open a question').toMatch(/onClick=\{\(\) => \{ setConfirmAbandon\(true\) \}\}/)
    expect(code, 'the abandon confirmation is missing').toContain('<ConfirmDialog')
    expect(code, 'the confirmation does not say how many questions are being dropped')
      .toMatch(/t\('review\.interactionAbandonConfirm',\s*\{\s*n:/)
    expect(code, 'the confirmation is shown by state nobody ever sets').toMatch(/confirmAbandon &&/)
    expect(code, 'dismissing does not close the question')
      .toMatch(/setConfirmAbandon\(false\)[\s\S]{0,80}setBusy\('cancel'\)/)
    // Options: numbered radios, or checkboxes for a multi-select, plus the
    // custom-answer row appended to the list.
    expect(card).toContain("role={item?.multiSelect === true ? 'checkbox' : 'radio'}")
    expect(card).toContain('interactionOptionNumber')
    expect(card).toContain('interactionCheck')
    expect(card).toContain('interactionCustomRow')
    expect(card).toContain('splitRecommended')
    expect(card).toContain("t('review.interactionRecommended')")
    // Field: the auto-growing mirrored textarea, inline beside options and
    // standalone as a block when the question offers none.
    expect(card).toContain('interactionFieldMirror')
    expect(card).toContain("variant=\"block\"")
    // Footer: pager + progress + the reason row + skip and next/submit.
    for (const key of ['review.interactionPrev', 'review.interactionNext', 'review.interactionProgress',
      'review.interactionSkip', 'review.interactionSubmit', 'review.interactionSubmitting']) {
      expect(card).toContain(`'${key}'`)
    }
    // Both refusal reasons, word-for-word with the native dictionary.
    expect(card).toContain("t('review.interactionUnanswered')")
    expect(card).toContain("t('review.interactionIncomplete')")
    expect(card).toContain("t('review.interactionRejected')")
    // Behaviour parity: single-select auto-advance, custom-clears-selection,
    // Enter continues (Shift+Enter and IME exempt), failed submit keeps the
    // card open with the reason.
    expect(card).toMatch(/item\?\.multiSelect !== true && !last \? index \+ 1 : index/)
    expect(card).toMatch(/selected: item\?\.multiSelect === true \? entry\.selected : \[\]/)
    expect(card).toMatch(/event\.key !== 'Enter' \|\| event\.shiftKey \|\| isComposing\(event\)/)
    expect(card).toMatch(/if \(!accepted\) setError\(t\('review\.interactionRejected'\)\)/)
  })

  it('计划正文在两张卡上都按 markdown 画（同一个渲染器，不是两种读法）', () => {
    /* 这一条钉的是一次「同一份内容两个样子」：能就地作答的那张卡早就走 `<Markdown>`，
       而只读的镜像卡把整份计划塞进一个 `<span>` —— 标题、清单、勾选框、代码块全都以原始
       记号出现在屏上，取决于这台机器的宿主支不支持就地作答。计划是模型写的 markdown，
       画法只有一处。
       
       判据读的是**结构**：`css.interactionDetail` 那一格只能是 `<div>`（装块的容器），
       而且里面必须有一个 `<Markdown>`——把纯文本塞回那一格就会红。注释先剥掉（硬性规范 14：
       检查器不许读字样）。 */
    const cardPath = fileURLToPath(new URL('../src/client/board/InteractionCard.tsx', import.meta.url))
    const code = readFileSync(cardPath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const blocks = [...code.matchAll(/<(span|div) className=\{css\.interactionDetail\}>([\s\S]{0,160}?)<\/\1>/g)]
    expect(blocks.length, '一处 interactionDetail 都没找到——这个检查扫不到东西').toBeGreaterThan(0)
    for (const [all, tag, body] of blocks) {
      expect(tag, `${all.slice(0, 60)}… 把说明文字画成了裸文本`).toBe('div')
      expect(body, `${all.slice(0, 60)}… 里没有渲染器`).toContain('<Markdown')
    }
    // 计划的正文本身在`PlanReviewCard`里也仍然是一个 markdown 块（不是被上面那条改没了）。
    expect(code).toMatch(/<Markdown text=\{plan\} \/>/)
  })

  it('the plan card keeps the native decisions (approve / decline / discuss)', () => {
    const cardPath = fileURLToPath(new URL('../src/client/board/InteractionCard.tsx', import.meta.url))
    const card = readFileSync(cardPath, 'utf8')
    const plan = card.slice(card.indexOf('function PlanReviewCard'))
    expect(plan).toContain('css.interactionStrip')
    expect(plan).toContain('css.interactionPlanBody')
    expect(plan).toContain("t('review.planConfirm')")
    expect(plan).toContain("t('review.planDecline')")
    expect(plan).toContain("t('review.interactionDiscuss')")
    // 那一次「同意」用的是**提问方自己命名的批准标签**（`intent.approve`），
    // 「拒绝」用的是提问方自己另一个选项——两处都不是按选项顺序猜的。
    expect(plan, '「同意」不再读提问方自己那个标签').toContain('planApproveAnswers(item)')
    expect(plan, '「拒绝」不再读提问方自己另一个选项').toContain('planDeclineAnswers(item)')
    // 没有可拒的选项时那一行不该存在，而答案里也绝不许出现空选择（那是「跳过整道题」）。
    expect(plan, '计划卡的答案里出现了空选择').not.toMatch(/selected:\s*\[\s*\]/)
    // 「去聊天里说」把这一次确认交回会话（载体的 dismiss），不是发一个空答案。
    expect(plan).toContain('cancelQuestion(question.rpcId)')
  })

  it('the comments region and the composer stay inside the rail content box', () => {
    expect(ruleOf('commentsScroll')).toContain('min-width: 0')
    // The comments region is the rail's ONLY scroller (one bar per surface).
    expect(ruleOf('commentsScroll')).toContain('overflow-y: auto')
    // The rail owns ONE 12px vertical rhythm; each segment keeps only its
    // own 14px content box (the composer's bottom breathing stays its own).
    expect(ruleOf('reviewComposer')).toMatch(/padding:\s*0 var\(--dsh-tb-rail-inset\) 12px/)
  })

  it('the transcript text shrinks and inline code breaks (never pierces the column)', () => {
    expect(ruleOf('reviewMessageText')).toContain('min-width: 0')
    expect(ruleOf('mdCode')).toContain('overflow-wrap: anywhere')
  })

  it('a proven wait without parsed content renders the honest shell (never blank nothing)', () => {
    // The 「plan 显示不了内容」 root fix, both halves: the mirror accepts a
    // detail-carried plan (covered in question-mirror.spec), and whatever the
    // parsers still cannot read falls back to a shell card — kind chip + one
    // honest line + the same navigate action — in the SAME chrome, so the
    // rail geometry cannot diverge between content and shell.
    const cardPath = fileURLToPath(new URL('../src/client/board/InteractionCard.tsx', import.meta.url))
    const cardSource = readFileSync(cardPath, 'utf8')
    expect(cardSource).toContain('shellWaiting')
    expect(cardSource).toContain('review.interactionBodyMissing')
    // Shell reuses the content chrome verbatim (no second layout to drift).
    const shell = cardSource.slice(cardSource.indexOf('if (question === undefined)'))
    expect(shell).toContain('css.interactionCard')
    expect(shell).toContain('css.interactionCardBody')
    expect(shell).toContain('css.interactionActions')
    expect(shell).toContain('review.interactionGoAnswer')
    // Every composer surface reads the one awaiting hook (review page,
    // session panel) — never the raw wire hook for
    // display. The shared rail takes the folded result as props.
    for (const file of ['ReviewDetail.tsx', 'SessionDetail.tsx']) {
      const source = readFileSync(fileURLToPath(new URL(`../src/client/board/${file}`, import.meta.url)), 'utf8')
      expect(source).toContain('useAwaitingCard')
    }
    const hookPath = fileURLToPath(new URL('../src/client/board/use-interaction.ts', import.meta.url))
    expect(readFileSync(hookPath, 'utf8')).toContain('export function useAwaitingCard')
  })

  it('entering either conversation surface stamps its read clock (mount-only)', () => {
    // 「点进那个会话的评论区里面了，卡片上的 session 还在闪」: the two
    // surfaces that REVEAL a conversation must acknowledge it, or the
    // per-session clock never hears about the visit. Execution review page →
    // markExecutionViewed; linked session panel → markTaskSessionViewed
    // (the same funnel a notification row's open uses). Both mount-only:
    // the surface's identity is its execution/session, and a stamp per
    // render would re-arm on every live update.
    const review = readFileSync(fileURLToPath(new URL('../src/client/board/ReviewDetail.tsx', import.meta.url)), 'utf8')
    expect(review).toMatch(/useEffect\(\(\) => \{\s*controller\.markExecutionViewed\(task\.id, execution\.id\)/)
    const panel = readFileSync(fileURLToPath(new URL('../src/client/board/SessionDetail.tsx', import.meta.url)), 'utf8')
    expect(panel).toMatch(/useEffect\(\(\) => \{\s*controller\.markTaskSessionViewed\(task\.id, sessionId\)/)
    // Mount-only: neither effect carries the ids in a re-run dependency list
    // (a stamp that re-ran per update would mask genuinely new arrivals
    // while the panel stays open).
    expect(panel.slice(panel.indexOf('markTaskSessionViewed') - 200, panel.indexOf('markTaskSessionViewed') + 200))
      .toContain('}, [])')
  })
})

describe('review rail scroll contract (ONE scroll body + pinned composer, every width)', () => {
  /** A whole `@container … { … }` block, brace-balanced from its marker. */
  function containerBlock(marker: string): string {
    const open = cssSource.indexOf(marker)
    if (open < 0) throw new Error(`container block "${marker}" is missing`)
    let depth = 0
    for (let i = open + marker.length - 1; i < cssSource.length; i++) {
      if (cssSource[i] === '{') depth++
      else if (cssSource[i] === '}') {
        depth--
        if (depth === 0) return cssSource.slice(open, i + 1)
      }
    }
    throw new Error('unbalanced container block')
  }

  /** One rule's OWN text inside a scope (up to its closing brace). */
  function ruleIn(scope: string, selector: string): string {
    const at = scope.indexOf(`${selector} {`)
    if (at < 0) return ''
    const end = scope.indexOf('}', at)
    return scope.slice(at, end < 0 ? undefined : end)
  }

  const stacked = (): string => containerBlock('@container dsh-tb-panel (max-width: 600px) {')

  it('the rail is [state] + [head, full render no scrollbar] + [comments own scroll] + [pinned composer]', () => {
    // The height contract the user restored: the head renders its config
    // FULLY (no internal scrollbar — a config cut at the model row with its
    // own slider is the 「显示不全」 failure), the comments own the rail's ONE
    // scroll region, and the composer is ALWAYS visible (flex none).
    expect(ruleOf('reviewComposer')).toMatch(/flex:\s*none/)
    // The head renders at its NATURAL height (flex none — it never shrinks a
    // config into a clipped box) and never caps or scrolls its own config.
    const head = ruleOf('sessionRailHead')
    expect(head).toMatch(/flex:\s*none/)
    expect(ruleOf('railHeadSection')).not.toMatch(/max-height/)
    expect(ruleOf('railHeadSection')).not.toMatch(/overflow-y/)
    // The comments region absorbs the leftover height and owns the scroller.
    expect(ruleOf('sessionRailComments[data-open=\'true\']')).toMatch(/flex:\s*1 1 auto/)
    expect(ruleOf('sessionRailComments[data-open=\'true\']')).toMatch(/min-height:\s*0/)
    // THE height pass-through: the Disclosure body relays its fold's definite
    // height down to the scroll region. Without these two properties the body
    // refuses to shrink below content, the box grows to full content and can
    // never scroll on its own — no scrollbar, no 滑到最新, no follow, while an
    // ancestor block scrolls the whole rail instead (the desktop defect).
    const foldBody = ruleOf('detailSectionBody')
    expect(foldBody).toMatch(/flex:\s*1 1 auto/)
    expect(foldBody).toMatch(/min-height:\s*0/)
    const comments = ruleOf('commentsScroll')
    expect(comments).toMatch(/flex:\s*1 1 auto/)
    expect(comments).toMatch(/overflow-y:\s*auto/)
    /* **地板必须是 0，原因写在注释里。** 这条断言的**意图**没变（「别被挤成一条缝」），
       但实现从「一个 120px 的 px 地板」改成了「归零 + 让 flex 分配」：
       那个 120px 在矮屏上比它所在的列还高，滚动区于是长出卡片之外、滚动条跟着出去
       （读者的原话：「滚动条的头感觉要突破天际」）。归零之后「让位」是对的，
       而「别太窄」由 `flex: 1 1 auto` 与上面的布局来保证，不是靠一个写死的数。
       机制判据见 `scripts/verify-scroll-floor.mjs`。 */
    expect(comments).toMatch(/min-height:\s*0/)
    // The scroll region owns the rail's content line; segments inside add none.
    expect(comments).toMatch(/padding:\s*10px var\(--dsh-tb-rail-inset\)/)
    expect(ruleOf('sessionFacts')).toMatch(/padding-inline:\s*var\(--dsh-tb-rail-inset\)/)
    // Inside the comments region the interaction card drops its margin.
    expect(cssSource).toMatch(/\.commentsScroll \.interactionCard\s*\{[^}]*margin:\s*0 0 2px/)
    // The rail is not a scroll container (see the rail layout contract above); the
    // folds block is the only scroller, so a scrolling rail can never push the
    // composer out of reach again.
    expect(ruleOf('reviewRail')).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/)
    // No trace of the retired single-scroll-body / dock grammars.
    expect(cssSource).not.toMatch(/\.sessionRailScroll\s*\{/)
    expect(cssSource).not.toMatch(/\.sessionContextDock\s*\{/)
  })

  it('the narrow panel is a THREE-ROW grid: capped folds / conversation / composer', () => {
    // The structural end of the截断 family. A flex
    // chain sharing a height lets the config head be `flex: none` (it never
    // yields) while the comments collapse toward zero to absorb the pressure,
    // and the composer — the LAST item in the rail's scroll content — ends up
    // below the fold, unreachable. A grid with a capped top row and the
    // composer as its OWN row makes that outcome unrepresentable.
    const block = stacked()
    const body = ruleIn(block, '.reviewBody')
    expect(body).toMatch(/display:\s*grid/)
    // `minmax(0, auto)` on BOTH content rows, not a fixed percentage: a fixed
    // `45%` track reserves 45% of the panel even with both folds collapsed (a
    // dead band above the conversation), and an unshrinkable `auto` composer
    // row gets clipped by `overflow: hidden` when a tall composer meets a short
    // panel (soft keyboard). min 0 + own scroll = always reachable; max auto =
    // never reserves space it does not need.
    expect(body).toMatch(/grid-template-rows:\s*minmax\(0,\s*auto\)\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*auto\)/)
    expect(body).toMatch(/grid-template-areas:[\s\S]*"folds"[\s\S]*"transcript"[\s\S]*"composer"/)
    expect(body).toMatch(/overflow:\s*hidden/)
    // The rail stops being a BOX so its segments can join the panel grid.
    expect(ruleIn(block, '.reviewRail')).toMatch(/display:\s*contents/)
    // Each region owns its scroll: the folds block is capped, the comments
    // box owns its capped scroll at EVERY width (one grammar — 滑到最新
    // drives it, desktop and phone), the conversation scrolls, the composer
    // never does.
    expect(ruleIn(block, '.sessionRailFolds')).toMatch(/grid-area:\s*folds/)
    expect(ruleIn(block, '.sessionRailFolds')).toMatch(/min-height:\s*0/)
    expect(ruleIn(block, '.commentsScroll')).toMatch(/overflow-y:\s*auto/)
    expect(ruleIn(block, '.commentsScroll')).toMatch(/max-height:\s*300px/)
    expect(ruleIn(block, '.reviewMain')).toMatch(/grid-area:\s*transcript/)
    expect(ruleIn(block, '.reviewComposer')).toMatch(/grid-area:\s*composer/)
    // The one case a non-shrinkable row cannot solve — a tall composer (long
    // draft, attached pictures) on a short panel (soft keyboard on a small
    // phone) — must degrade to a scrolling composer, never to a send button
    // cut off OUTSIDE every scrollport by the panel's own overflow:hidden.
    expect(ruleIn(block, '.reviewComposer')).toMatch(/min-height:\s*0/)
    expect(ruleIn(block, '.reviewComposer')).toMatch(/overflow-y:\s*auto/)
    // Placement is by NAMED AREA, never by `order` (an order on an item of a
    // contents parent reads against the wrong container).
    expect(block).not.toMatch(/\.reviewMain\s*\{[^}]*order:/)
    expect(block).not.toMatch(/\.reviewRail\s*\{[^}]*order:/)
    // No container/viewport unit for a height share (the board box is
    // inline-size only, so a block container unit would silently become one).
    expect(block).not.toMatch(/(max-height|flex-basis|height):\s*[\d.]+(cqh|cqb|vh|dvh)/)
    // The conversation keeps its own scroller in the stacked form too.
    expect(ruleIn(block, '.reviewTranscriptScroll')).toMatch(/overflow-y:\s*auto/)
  })

  it('the rail is TWO blocks at every width: folds (flexes) + composer (pinned)', () => {
    // The wide form is unchanged in GEOMETRY — the four segments simply live
    // in one wrapper now, which is what the narrow grid can cap.
    const folds = ruleOf('sessionRailFolds')
    expect(folds).toMatch(/flex:\s*1 1 auto/)
    expect(folds).toMatch(/min-height:\s*0/)
    expect(folds).toMatch(/display:\s*flex/)
    expect(ruleOf('reviewComposer')).toMatch(/flex:\s*none/)
    // The composer prints ONE line, and only when it has something to refuse:
    // 「排队」/「插话」 already spell out the two send modes on the buttons
    // themselves, so the line that explained them was a third copy — it is gone.
    // A blocking reason has no other outlet, so that one still renders, and it
    // renders HERE rather than inside a fold (a collapsed fold on a phone must
    // not hide why sending is refused).
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panelSource = readFileSync(panelPath, 'utf8')
    const composer = panelSource.slice(panelSource.indexOf('export function SessionComposer'))
    expect(composer).toMatch(/hint\?: string/)
    expect(composer).toMatch(/\{hint !== undefined && <p className=\{css\.detailHint\}>\{hint\}<\/p>\}/)
    // …and it must not fall back to any built-in sentence of its own.
    expect(composer).not.toMatch(/sessionDriveHint/)
    // …and the rail no longer takes it.
    const rail = panelSource.slice(panelSource.indexOf('export function SessionRail'), panelSource.indexOf('export function SessionComposer'))
    expect(rail).not.toMatch(/hint\?: string/)
  })

  it('the review family queries its OWN panel width, declared on .review', () => {
    // A wide board with a capped 880px panel no longer keeps a cramped
    // one-row header, and split screens stack honestly: the geometry
    // reference is the surface that must fit, not the window.
    const review = ruleOf('review')
    expect(review).toMatch(/container-type:\s*inline-size/)
    expect(review).toMatch(/container-name:\s*dsh-tb-panel/)
    expect(stacked()).not.toBe('')
    // The panel cannot query itself: its own width inset rides the board
    // container (panel = board − 48 backdrop padding → a 600px panel floor
    // is a 648px board floor).
    const boardSized = containerBlock('@container dsh-tb (max-width: 648px) {')
    expect(boardSized).toMatch(/\.review\s*\{[^}]*width:\s*calc\(100% - 16px\)/)
    // The board-anchored 600px review block must stay gone.
    expect(cssSource).not.toMatch(/@container dsh-tb \(max-width: 600px\) \{/)
  })

  it('the narrow header is a deterministic grid: title+badge+× one plane (× ALWAYS top-right), then context LEFT + actions RIGHT', () => {
    const block = stacked()
    // The header is a NAMED GRID at BOTH widths (never flex-wrap + order,
    // which drifted the layout with content — × sometimes fell to line 2's
    // left, 刷新/查看会话 sometimes squeezed onto line 1). The narrow block
    // only RE-MAPS the same five names (title/badge/context/actions/close)
    // to two lines: line 1 = title | badge | close (× always top-right,
    // centered with the title); line 2 = context | actions. The title stays
    // single-line. The base rule carries display:grid + areas; the narrow
    // block carries only the override.
    expect(ruleOf('reviewHeader')).toMatch(/display:\s*grid/)
    expect(ruleOf('reviewHeader')).toMatch(/grid-template-areas:[\s\S]*"title badge context actions close"/)
    expect(ruleIn(block, '.reviewHeader')).toMatch(/grid-template-areas:[\s\S]*"title badge close"[\s\S]*"context actions actions"/)
    expect(ruleIn(block, '.reviewHeader > .iconButton')).not.toMatch(/position:\s*absolute/)
    // WIDE: everything on ONE line — context between the badge and actions,
    // capped, same center baseline (the 「标题栏不在同一水平面」 fix).
    const wideContext = ruleOf('reviewHeaderContext')
    expect(wideContext).toMatch(/grid-area:\s*context/)
    expect(wideContext).toMatch(/max-width:\s*320px/)
  })

  it('the header context expansion is an in-flow dock row at BOTH widths (never an overlay)', () => {
    // The 「会话上下文穿模」 root fix, structurally: an absolutely anchored
    // popover for the expanded panel paints OVER the transcript, the run
    // config and the comments on both widths, so the panel has to stay in flow.
    // The open wrap dissolves
    // (display:contents) and the panel joins the header grid as an implicit
    // full-width row BELOW the whole head row — expanding pushes the body
    // down, so overlap is unrepresentable. Capped + internally scrolled at
    // both widths.
    const blockPath = fileURLToPath(new URL('../src/client/board/SessionContextBlock.tsx', import.meta.url))
    const blockSource = readFileSync(blockPath, 'utf8')
    expect(blockSource).toMatch(/data-open=\{open \? '' : undefined\}/)
    expect(cssSource).toMatch(/\.reviewHeaderContext\[data-open\]\s*\{[^}]*display:\s*contents/)
    expect(cssSource).toMatch(/\.reviewHeaderContext\[data-open\] > \.sessionContextHead\s*\{[^}]*grid-area:\s*context/)
    // The dissolved wrap's 320px cap moves onto the open head (wide); the
    // narrow tier lifts it so the readout takes the whole track.
    expect(cssSource).toMatch(/\.reviewHeaderContext\[data-open\] > \.sessionContextHead\s*\{[^}]*max-width:\s*320px/)
    expect(ruleIn(stacked(), '.reviewHeaderContext[data-open] > .sessionContextHead')).toMatch(/max-width:\s*none/)
    const dock = cssSource.slice(cssSource.indexOf('.reviewHeaderContext[data-open] > .sessionContextPanel'))
    expect(dock).toMatch(/grid-column:\s*1 \/ -1/)
    expect(dock).toMatch(/position:\s*static/)
    expect(dock).toMatch(/max-height:\s*320px/)
    expect(dock).toMatch(/overflow-y:\s*auto/)
    // No overlay grammar left in the header context: no absolute panel, no
    // head-box anchor, no paint-under z-index.
    expect(cssSource).not.toMatch(/\.reviewHeaderContext \.sessionContextPanel\s*\{[^}]*position:\s*absolute/)
    expect(cssSource).not.toMatch(/\.reviewHeaderContext \.sessionContextPanel\s*\{[^}]*left:\s*0/)
    expect(cssSource).not.toMatch(/\.reviewHeaderContext \.sessionContextPanel\s*\{[^}]*z-index:\s*1/)
    // The narrow tier only tightens the cap — same in-flow grammar, no
    // positioning of its own (any relative/static/absolute here re-squeezes
    // it into the cell or re-floats it over the body).
    const narrowPanel = ruleIn(stacked(), '.reviewHeaderContext[data-open] > .sessionContextPanel')
    expect(narrowPanel).toMatch(/max-height:\s*240px/)
    expect(narrowPanel).not.toMatch(/position:/)
  })

  it('the header keeps no overlay stacking for the context readout', () => {
    // With the panel in-flow there is nothing to paint under anything: the
    // isolation context and the head/actions/close z-index ladder retire, as
    // does the descendant wrap selector that never matched (the wrap IS the
    // cell). The no-double-inset intent now rides an honest compound rule.
    const context = ruleOf('reviewHeaderContext')
    expect(context).not.toMatch(/isolation:\s*isolate/)
    expect(cssSource).not.toMatch(/\.reviewHeaderContext \.sessionContextHead,/)
    expect(cssSource).not.toMatch(/\.reviewHeaderContext \.sessionContextWrap\s*\{/)
    expect(cssSource).toMatch(/\.reviewHeaderContext\.sessionContextWrap\s*\{[^}]*padding:\s*0/)
  })

  it('the review title is single-line ellipsis on a phone (header stays one plane)', () => {
    // The narrow header keeps the title on one line so title/badge/× never
    // drift apart; the full name is in the tooltip. (No line-clamp — that
    // reserves a box while painting outside it.)
    const title = ruleIn(stacked(), '.reviewTitle')
    expect(title).not.toMatch(/line-clamp/)
    expect(title).not.toMatch(/white-space:\s*normal/)
  })

  it('the header action cluster is same-height (24px pills + 24px close)', () => {
    // 「同一排控件同级高」: a 30px circle beside 24px pills is the misalignment
    // the eye reads as sloppiness. The size rides the sm token (or its equal
    // literal) — the test pins the VALUE, never the spelling.
    // The size step, in the sheet that can render it.
    expect(renderedSource).toMatch(/\.iconButtonSm\s*\{[^}]*width:\s*var\(--dsh-tb-button-h-sm\)[^}]*height:\s*var\(--dsh-tb-button-h-sm\)/)
    // …and this surface asking for that step, read from the markup rather than
    // named here, so a rename moves the gate with the code.
    const frame = readFileSync(fileURLToPath(new URL('../src/client/board/SessionFrame.tsx', import.meta.url)), 'utf8')
    expect(frame).toMatch(/<IconButton[^>]*size="sm"/)
  })

  it('the fold defaults follow the PANEL width, not the viewport', () => {
    // A mid-size window with the shell sidebar open already renders the
    // stacked panel (the container query) while `matchMedia` still says
    // "wide" — a default that followed the viewport would disagree with the
    // geometry the user is looking at. The hook measures the same surface the
    // CSS queries, and the panel is stamped for it.
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panelSource = readFileSync(panelPath, 'utf8')
    expect(panelSource).toMatch(/useSurfaceNarrow\('\[data-dsh-taskboard-panel\]', bandNarrowMax\('sessionPanel', 600\)\)/)
    // The comments default follows the PANEL width (open desktop, folded
    // phone — an open thread would bury the conversation there); only the
    // config head keeps a single narrow-default. Tap toggles either way.
    expect(panelSource).toMatch(/useState\(!narrowPanel\)/)
    const framePath = fileURLToPath(new URL('../src/client/board/SessionFrame.tsx', import.meta.url))
    expect(readFileSync(framePath, 'utf8')).toContain('data-dsh-taskboard-panel=""')
    const hookPath = fileURLToPath(new URL('../src/client/design/use-narrow.ts', import.meta.url))
    const hook = readFileSync(hookPath, 'utf8')
    expect(hook).toMatch(/new ResizeObserver\(measure\)/)
    // Every observer is disposed (lifecycle rule 6).
    expect(hook).toMatch(/return \(\) => \{ observer\.disconnect\(\) \}/)
  })

  it('the rail head folds through the SHARED Disclosure (turning chevron, no hand-rolled twin)', () => {
    // The hand-rolled toggle row was a Disclosure copy that forgot the
    // rotation — "the symbol never changes" was duplication, not taste.
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panelSource = readFileSync(panelPath, 'utf8')
    expect(panelSource).toMatch(/<Disclosure/)
    expect(cssSource).not.toMatch(/sessionRailHeadToggle/)
    expect(cssSource).not.toMatch(/sessionRailHeadTitle/)
    // The fold grammar turns: collapsed points right, expanded points down.
    //
    // **判据读的是「折叠记号只有一个家」，不是某一个具体选择器。** 这条曾经钉住
    // `.detailDisclosure[aria-expanded='false'] .detailChevron` 那行字——而它只是
    // 当时那一个消费者的写法。旋转后来被收进共享的 `.foldMark`（判据只认祖先里的
    // `aria-expanded`，不绑任何类名或结构），于是钉字样的断言会在一次**正确的收敛**
    // 之后变红，而它想守的那件事（折叠会转）从头到尾都成立。
    //
    // 现在钉四件更硬的事：共享层有那条判据、判据不绑结构、消费者都挂了它、以及
    // 没有第二处手写旋转。这比原来那条正则更难作弊。
    expect(renderedSource).toMatch(/\.foldMark\s*\{[^}]*transition:\s*transform/)
    expect(renderedSource).toMatch(/\[aria-expanded='false'\]\s*\.foldMark\s*\{[^}]*rotate\(-90deg\)/)
    expect(renderedSource).toMatch(/\[aria-expanded='true'\]\s*\.foldMark\s*\{/)
    /* 判据不绑结构：`[aria-expanded]` 那一条前面不许出现任何类名。 */
    expect(renderedSource).not.toMatch(/\.[a-zA-Z][\w-]*\[aria-expanded='(true|false)'\]\s*\.foldMark/)
    const disclosureSource = readFileSync(
      fileURLToPath(new URL('../src/client/design/ui.tsx', import.meta.url)),
      'utf8',
    )
    expect(disclosureSource, '共享的 Disclosure 没有挂折叠记号').toMatch(/detailChevron\} \$\{css\.foldMark\}/)
    /* 会话上下文那块在 `SessionContextBlock.tsx`（不是 `session-panel.tsx`）。 */
    const contextSource = readFileSync(
      fileURLToPath(new URL('../src/client/board/SessionContextBlock.tsx', import.meta.url)),
      'utf8',
    )
    expect(contextSource, '会话上下文那块自己写了旋转，没走共享记号')
      .toMatch(/sessionContextChevron\} \$\{components\.foldMark\}/)
    expect(cssSource).not.toMatch(/sessionContextChevronOpen/)
    /* **全仓不许再有第二处手写旋转。** 折叠记号只有一个家这件事，由这一条兜住。 */
    const boardSheet = readFileSync(
      fileURLToPath(new URL('../src/client/board.module.css', import.meta.url)),
      'utf8',
    )
    expect(boardSheet, '看板表里又长出了一条手写旋转').not.toMatch(/rotate\(-90deg\)/)
  })

  it('the engine-note dialog body rides the shared .modalScroll (no flush text)', () => {
    // Every other Dialog wraps its children in the SHARED scroll body; the one
    // call site that skipped it printed the explanation flush against the panel.
    // The shared body lives with the overlay family (design/), beside `.modal`
    // and `.dialogHeader` — so it is read from there, not from a page sheet.
    const tsxPath = fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url))
    const board = readFileSync(tsxPath, 'utf8')
    const at = board.indexOf('engineNote !== undefined')
    expect(at).toBeGreaterThan(-1)
    const dialog = board.slice(at, at + 1500)
    expect(dialog).toContain('components.modalScroll')
    // …and the shared body really carries the inset. Without it the text
    // prints flush against the panel edge — the defect this call site once had
    // (a page-local copy of the body, with the padding left out).
    expect(ruleOf('modalScroll')).toMatch(/padding:\s*14px 18px/)
  })

  it('the context popover caps in px, never a viewport unit', () => {
    const panel = ruleOf('sessionContextPanel')
    expect(panel).toMatch(/max-height:\s*320px/)
    expect(panel).not.toMatch(/\dvh/)
  })

  it('the rail is TWO folds: head renders FULLY, comments own the region', () => {
    // The user's model: the head (config) renders completely — no internal
    // scrollbar; the comments are the rail's ONE scroll region and stay
    // foldable. Both are Disclosures (one fold grammar).
    const head = ruleOf('sessionRailHead')
    expect(head).not.toMatch(/position:\s*sticky/)
    // No capped internal body — the config shows 100%.
    expect(cssSource).not.toMatch(/sessionRailHeadBody/)
    // The comments region exists and scrolls (checked in the rail contract).
    expect(cssSource).toMatch(/\.sessionRailComments\s*\{/)
    expect(cssSource).toMatch(/\.commentsScroll\s*\{/)
    // session-panel renders TWO Disclosure folds (config + comments); the
    // comments scroll box drives the follow; NO context dock (it is in the
    // header now).
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panelSource = readFileSync(panelPath, 'utf8')
    const disclosures = panelSource.match(/<Disclosure/g) ?? []
    expect(disclosures.length).toBeGreaterThanOrEqual(2)
    expect(panelSource).toMatch(/commentsScroll/)
    expect(panelSource).not.toMatch(/sessionContextDock/)
    expect(panelSource).not.toMatch(/context=\{context\}/)
    // A pending interaction must FORCE the comments fold open — the
    // InteractionCard carries the answer affordance (in place on legacy
    // hosts, navigate-to-answer on 0.1.5), so a collapsed fold can never
    // hide it. The honest shell (proven wait without parsed content) owns
    // the same force-open through the single `awaiting` boolean — one
    // condition, never two parallel ones to drift apart.
    expect(panelSource).toMatch(/open=\{commentsOpen \|\| awaiting\}/)
    expect(panelSource).toMatch(/awaiting = interaction !== undefined \|\| shellWaiting !== undefined/)
    // The 0.1.5 mirror card is read-only: the mirror branch renders options
    // as spans (never buttons), one navigate action, no submit path that
    // could race the native answerer. (The legacy in-place branch keeps its
    // button grammar for pre-0.1.5 hosts.)
    const cardPath = fileURLToPath(new URL('../src/client/board/InteractionCard.tsx', import.meta.url))
    const cardSource = readFileSync(cardPath, 'utf8')
    expect(cardSource).toMatch(/function MirrorQuestionCard/)
    expect(cardSource).toMatch(/review\.interactionGoAnswer/)
    const mirrorBranch = cardSource.slice(cardSource.indexOf('function MirrorQuestionCard'))
    expect(mirrorBranch).not.toMatch(/<button/)
    // The meter head is one line at every width (reading | percent | figures);
    // the breakdown is one row per bucket — never a wrapping flex cluster
    // (the 「对话消息另起一行」 family).
    expect(cssSource).toMatch(/\.reviewMeterHead\s*\{[^}]*white-space:\s*nowrap/)
    expect(cssSource).toMatch(/\.reviewMeterRows\s*\{[^}]*display:\s*grid/)
    // 滑到最新 binds ONLY the comments scroller (the 「跳转范围错误」 fix). The
    // pill reads the COMMENTS pin and nothing else — and it lives in that region's
    // frame as a SIBLING of the scroller, because an absolute child of a scroller
    // rides the scroll offset (measured; see `.sessionScrollFrame`).
    expect(panelSource).toMatch(/<TailFrame pin=\{commentsPin\}>/)
    expect(panelSource, 'the pill must not be a child of the scroller').not.toMatch(/<div className=\{css\.commentsScroll\}[^>]*>\s*<CommentsThread[\s\S]{0,600}<TailPill/)
  })

  it('the rail is flexible in the base layout (two columns survive down to the floor)', () => {
    // A rigid 344px rail forced the stacked fallback far too early; the base
    // width must be a container-query clamp, not a fixed px.
    const rail = ruleOf('reviewRail')
    expect(rail).toContain('width: min(344px, 46cqw)')
  })
})

describe('scroll-follow is ONE mechanism (no per-mode fork)', () => {
  const tsxPath = fileURLToPath(new URL('../src/client/board/use-transcript.tsx', import.meta.url))
  const followSource = readFileSync(tsxPath, 'utf8')
  const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
  const panelSource = readFileSync(panelPath, 'utf8')

  it('the tail follows the REAL scroller and listens on THAT element', () => {
    // The stacked panel scrolls its BODY, not the inner region, so the hook has
    // to resolve which element actually scrolls. That part was always right.
    expect(followSource).toMatch(/export function resolveScroller/)
    expect(followSource).toMatch(/export function useFollowScroll/)

    // WHERE the listener goes is the part that changed, and the reason is
    // performance rather than taste. A capture-phase listener on `document` runs
    // for every scroll on the page and reads three layout properties; Chrome
    // cannot take its gesture fast path around such a listener, so it waits for
    // the main thread before committing the frame — 「滚了，等一下才动」, and it
    // costs the same whether the panel holds one message or two hundred.
    // Bound to the scroller itself, only that scroller pays, and it is passive.
    expect(followSource, 'the scroll listener must be passive').toMatch(/addEventListener\('scroll', onScroll, \{ passive: true \}\)/)
    expect(followSource, 'the scroll listener must not sit on document in the capture phase')
      .not.toMatch(/document\.addEventListener\('scroll'/)
    expect(followSource, 'the scroll listener must not sit on window in the capture phase')
      .not.toMatch(/window\.addEventListener\('scroll'/)
  })

  it('the comment thread reuses the same hook instead of re-rolling it', () => {
    expect(panelSource).toMatch(/useFollowScroll\(/)
    // No hand-rolled scrollTop pinning left in the panel (one mechanism —
    // the only scrollTop writes are the follow/jump/anchor paths).
    const writes = panelSource.match(/scrollTop\s*=/g) ?? []
    expect(writes.length).toBe(0)
    // …and no second dispatch of the measurement: the hook already owns a passive
    // listener on this very element, and React does not mark `scroll` passive, so
    // an `onScroll` prop here would make every scroll event wait for the main
    // thread before its frame could commit.
    expect(panelSource, 'a React onScroll is a second dispatch of the same measurement')
      .not.toMatch(/onScroll=/)
    // OPEN / NEW ASK = LATEST: opening the comments fold (manual tap or a
    // pending question force-opening it) and every new ask pin the box to the
    // newest comment; the old per-open opt-out (`initialToBottom`) is gone —
    // there is exactly one semantic, not a first-open/re-open fork.
    expect(panelSource).toMatch(/const openEdgeRef = useRef\(commentsOpen \|\| awaiting\)/)
    expect(panelSource).toMatch(/if \(awaiting \|\| opened\) commentsPin\.jump\(\)/)
    expect(panelSource).not.toMatch(/initialToBottom/)
    expect(followSource).not.toMatch(/initialToBottom/)
  })

  it('the tail accumulates (poll extends, never replaces) and pages backward natively', () => {
    // The 「刷新即暂无对话内容」 fix: the poll merges by seq (no
    // same-watermark replace), and earlier pages prepend above the window
    // through the native session.page grammar (beforeSeq = the window's
    // first seq), anchored to the bottom.
    expect(followSource).toMatch(/loadEarlier/)
    expect(followSource).toMatch(/loadTranscriptPage/)
    expect(followSource).toMatch(/floorRef/)
    expect(followSource).toMatch(/scrollHeight/)
    expect(followSource).toMatch(/scrollTop/)
    /* THE ANCHOR IS TAKEN WHEN THE PAGE LANDS, NOT WHEN THE TAP HAPPENS.
     *
     * The distance that must survive the prepend is 「where the reader is when the
     * page arrives」 — they keep reading while the read is in flight, so a reading
     * taken at the click describes a position they have already left. Structural
     * form: `pin.hold()` appears AFTER the page request and BEFORE `setEvents`, so
     * the DOM it measures is still the pre-prepend one. */
    const pageAt = followSource.indexOf('controller.loadTranscriptPage(')
    const settleAt = followSource.indexOf('pin.hold()')
    const setEventsAt = followSource.indexOf('setEvents(', pageAt)
    expect(pageAt, 'loadEarlier must ask the host for a page').toBeGreaterThan(-1)
    expect(settleAt, 'the reader\'s place must be captured through the pin').toBeGreaterThan(-1)
    expect(setEventsAt, 'loadEarlier must repaint the window').toBeGreaterThan(-1)
    expect(settleAt, 'the anchor must be measured on the page that landed, not at the click')
      .toBeGreaterThan(pageAt)
    expect(settleAt, 'the anchor must be read before the window is replaced, or it measures the new one')
      .toBeLessThan(setEventsAt)
    const platformPath = fileURLToPath(new URL('../src/client/platform.ts', import.meta.url))
    const platformSource = readFileSync(platformPath, 'utf8')
    expect(platformSource).toMatch(/beforeSeq/)
    // The "load earlier" row lives ABOVE the list (older lives above), and
    // renders whenever the host says there is more — even over an EMPTY
    // window (a misaligned tail that folds to zero lines with hasMore must
    // still offer the way back; empty text with no button is a dead end).
    expect(cssSource).toMatch(/\.transcriptEarlierRow/)
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panelSource2 = readFileSync(panelPath, 'utf8')
    expect(panelSource2).toMatch(/transcriptEarlierRow/)
    expect(panelSource2).toMatch(/review\.loadEarlier/)
    // The paging row is OUTSIDE the empty/list conditional (visible over an
    // empty window), and the handler falls back to the window's first seq
    // when the host sends hasMore without a floorSeq (a visible button that
    // no-ops is the "点了没反应" bug).
    const pagingAt = panelSource2.indexOf('transcriptEarlierRow')
    const emptyAt = panelSource2.indexOf('review.transcriptEmpty')
    expect(pagingAt).toBeGreaterThan(-1)
    expect(emptyAt).toBeGreaterThan(-1)
    expect(pagingAt).toBeLessThan(emptyAt)
    expect(followSource).toMatch(/floorRef\.current \?\? eventsRef\.current/)
    // The follow opening's log cut threads tail → hook → page request (the
    // page grammar's other half — a cut-less call is rejected by the host).
    expect(followSource).toMatch(/throughSeqRef/)
    expect(followSource).toMatch(/loadTranscriptPage\(sessionId, floor, throughSeqRef\.current\)/)
  })

  it('a failed earlier-page read is SAID (the button stays — tapping retries)', () => {
    // An old host without the page endpoint answers every click with
    // undefined: without this the button spins once and goes quiet (the
    // second "点了没反应"). The hook keeps hasMore, flags pageError, and
    // the row shows a quiet retry line under the button.
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panelSource = readFileSync(panelPath, 'utf8')
    expect(followSource).toMatch(/pageError/)
    expect(followSource).toMatch(/setPageError\(true\)/)
    expect(panelSource).toMatch(/pageError/)
    expect(panelSource).toMatch(/review\.loadEarlierFailed/)
  })

  it('a missing page endpoint is TERMINAL (no button, no retry loop)', () => {
    // Retrying an endpoint that does not exist is the infinite dead loop:
    // the refused wire code (`remote/unavailable`) flips pageUnsupported,
    // the button goes away, and the line names the missing server
    // capability. Any other refusal keeps the retry grammar above.
    expect(followSource).toMatch(/pageUnsupported/)
    expect(followSource).toMatch(/page\.refused === 'remote\/unavailable'/)
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panelSource = readFileSync(panelPath, 'utf8')
    expect(panelSource).toMatch(/pageUnsupported/)
    expect(panelSource).toMatch(/review\.loadEarlierUnsupported/)
    // The refused page carries its code through the wiring (the console
    // line is the whole remote diagnosis).
    const wiringPath = fileURLToPath(new URL('../src/client/index.ts', import.meta.url))
    expect(readFileSync(wiringPath, 'utf8')).toMatch(/refused: response\.result\.error\.code/)
  })

  it('comment attachment lines name their own kind (images ≠ files, never one paraphrase)', () => {
    // The "发文件却显示含图片" worry: the thread renders the image line and
    // the file line as TWO independent conditionals (count-guarded each), so
    // images-only / files-only / both / neither all read correctly — no shared
    // label can drift across kinds. Both counts come from ONE reader, which is
    // what makes a steered (插话) picture and a queued one read the same.
    const threadPath = fileURLToPath(new URL('../src/client/board/CommentsThread.tsx', import.meta.url))
    const thread = readFileSync(threadPath, 'utf8')
    expect(thread).toMatch(/attachmentCountsOf\(attachmentsOf\(/)
    expect(thread).toMatch(/counts\.images > 0[\s\S]{0,200}review\.commentImages/)
    expect(thread).toMatch(/counts\.files > 0[\s\S]{0,200}review\.commentFiles/)
  })

  it('the attachment busy line names the in-flight intake, never the ledger', () => {
    // A staging file is not in the ledger yet: naming the busy line from
    // settled chips is exactly the "传文件却显示图片压缩中" lie. The hook
    // tracks per-lane in-flight counts; every caller renders the helper.
    const composerPath = fileURLToPath(new URL('../src/client/board/composer-attachments.ts', import.meta.url))
    const composer = readFileSync(composerPath, 'utf8')
    expect(composer).toMatch(/busyKind/)
    expect(composer).toMatch(/busyKindOf\(/)
    // 标签与它读的那个类型同住一处：元件是设计系统的（它只画芯片），而"这一条在传什么"
    // 是台账的词汇。这一对分开住，正是那条分界本身。
    expect(composer).toMatch(/export function attachBusyLabel/)
    const strip = readFileSync(fileURLToPath(new URL('../src/client/design/AttachmentStrip.tsx', import.meta.url)), 'utf8')
    // 结构，不是字样（硬性规范 14）：元件可以在注释里**提到**那句话住在哪，但它不许
    // **调用**台账的词汇，也不许 import 任何一页——那两条才是"设计系统不认识台账"。
    expect(strip, '设计系统里的那一枚不该认识台账的忙闲').not.toMatch(/attachBusyLabel\(/)
    expect(strip, '设计系统里的那一枚不该 import 页面').not.toMatch(/from '\.\.\/board\//)
    for (const name of ['session-panel.tsx', 'TaskForm.tsx']) {
      const caller = readFileSync(fileURLToPath(new URL(`../src/client/board/${name}`, import.meta.url)), 'utf8')
      expect(caller).toContain('attachBusyLabel(attachments.busyKind)')
    }
    // No caller may still name the busy line from settled chips.
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    expect(readFileSync(panelPath, 'utf8')).not.toMatch(/attachedFiles\.length > 0 \? t\('review\.attachFileBusy'\)/)
  })

  it('color is managed in exactly two places: the 整理 panel and the card itself', () => {
    // User decision: the task edit form no longer carries a palette. Color is
    // assigned where it is meaningful — in bulk (整理) or in place (hover the
    // card) — and the form is about the task's CONTENT only, where a swatch row
    // between 描述 and 执行 Prompt read as a third content field.
    const formPath = fileURLToPath(new URL('../src/client/board/TaskForm.tsx', import.meta.url))
    const form = readFileSync(formPath, 'utf8')
    expect(form).not.toContain('ColorSwatches')
    expect(form).not.toContain('withColor')
    const detailPath = fileURLToPath(new URL('../src/client/board/TaskDetail.tsx', import.meta.url))
    expect(readFileSync(detailPath, 'utf8')).not.toContain('withColor')
    // The two sanctioned homes stay: the organize bar's swatch row and the
    // card's hover strip (zero-render until hover, so a card face is never
    // crowded by the palette).
    const boardPath = fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url))
    expect(readFileSync(boardPath, 'utf8')).toContain('<ColorSwatches')
    const cardPath = fileURLToPath(new URL('../src/client/board/TaskCard.tsx', import.meta.url))
    const card = readFileSync(cardPath, 'utf8')
    expect(card).toContain('cardColorBar')
    expect(card).toContain('<ColorSwatches')
    const sheet = pageCss('board')
    expect(sheet).toMatch(/\.card:hover \.cardColorBar,\s*\n\.card:focus-within \.cardColorBar \{\s*\n\s*display: flex;/)
  })

  it('comment drafts persist attachments (text is not the only survivor)', () => {
    // The reported loss: text came back, staged images/files did not. The
    // composer now saves the full envelope — text + the REFS it carries — and
    // restores through the hook, so a draft that comes back comes back whole
    // (pictures AND files; a per-Agent receipt could not survive, and neither
    // could the old byte cap). v1 leftovers are re-admitted on restore.
    for (const [name, key] of [['session-panel.tsx', 'commentDraftKey']] as const) {
      const caller = readFileSync(fileURLToPath(new URL(`../src/client/board/${name}`, import.meta.url)), 'utf8')
      expect(caller).toContain('encodeCommentDraft(')
      expect(caller).toContain('decodeCommentDraft(')
      expect(caller).toContain(key)
      expect(caller).toContain('restored.legacyImages')
    }
    // No raw-text draft write may clobber the envelope (the persist effect
    // owns the store after restore).
    const panel = readFileSync(fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url)), 'utf8')
    expect(panel).not.toMatch(/draftStore\.set\(storeKey, text\)/)
    expect(panel).not.toMatch(/draftStore\.set\(storeKey, next\)/)
  })

  it('the Agent row reads the official projection and renders the selected name', () => {
    // The Host's session projection is the applied identity; the roster maps
    // that stable id to the name the user selected. The device ledger remains
    // only the compatibility path when a Host exposes no projection.
    const corePath = fileURLToPath(new URL('../src/core/controller.ts', import.meta.url))
    const core = readFileSync(corePath, 'utf8')
    expect(core).toContain('summary.projectionValues?.agentPreset')
    expect(core).toContain('projected === null')
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panel = readFileSync(panelPath, 'utf8')
    expect(panel).toContain('catalog.listAgentPresets()')
    expect(panel).toContain('agentPresetLabelOf(info.agentPreset, agentPresets)')
    const execPath = fileURLToPath(new URL('../src/core/execution.ts', import.meta.url))
    const exec = readFileSync(execPath, 'utf8')
    // Both apply sites report success (failures never fire — the session
    // kept its previous preset; recording it would be a lie).
    expect(exec.match(/onAgentApplied\?\.\(sessionId/g)?.length).toBe(2)
    const wiringPath = fileURLToPath(new URL('../src/client/index.ts', import.meta.url))
    const wiring = readFileSync(wiringPath, 'utf8')
    expect(wiring).toContain('onAgentApplied: (sessionId, preset)')
    expect(wiring).toContain('sessionAgentStore')
  })
})

/**
 * 折叠的语法：**一轮一个组**，过程归在过程里，最后那段话露在外面。
 *
 * 这一节钉的是读者报上来的那句话：「我评论一句，他回复一段话，而不是出现一些过程中
 * 可能思考了一下又说了一句话」。所以每条用例都在问同一件事——**一条消息的归属**：
 * 它属于「触发句」「过程」还是「最后那段话」。
 */
describe('foldTurns', () => {
  const base = { seq: 1, time: 1000 }

  /** A user/message event with the native flat shape. */
  function userMessage(id: string, text: string, sourceKind = 'user', extra: Record<string, unknown> = {}): TranscriptEvent {
    return {
      ...base,
      type: 'user/message',
      data: { id, role: 'user', content: [{ type: 'text', text }], source: { kind: sourceKind, ...extra } },
    }
  }

  /** An assistant/message event with the native wrapped shape. */
  function assistant(turn: number, step: number, id: string, blocks: unknown[], usage?: Record<string, number>): TranscriptEvent {
    return {
      ...base,
      type: 'assistant/message',
      data: { turn, step, message: { id, role: 'assistant', content: blocks }, ...usage !== undefined ? { usage } : {} },
    }
  }

  it('按轮分组：触发句、过程、回复各归各位', () => {
    const events: TranscriptEvent[] = [
      { ...base, seq: 1, type: 'turn/start', data: { turn: 1 } },
      userMessage('m1', '你好'),
      { ...base, seq: 3, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'read' } },
      { ...base, seq: 4, type: 'tool/result', data: { turn: 1, step: 1, message: { toolCallId: 'c1', isError: false } } },
      assistant(1, 1, 'a1', [{ type: 'reasoning', text: '想一想' }, { type: 'text', text: '途中说一句' }]),
      assistant(1, 2, 'a2', [{ type: 'text', text: '最后那段话' }]),
      { ...base, seq: 7, time: 2000, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const [turn] = foldTurns(events)
    expect(turn.turn).toBe(1)
    expect(turn.trigger).toMatchObject({ id: 'm1', text: '你好' })
    expect(turn.steps).toMatchObject([
      { kind: 'tool', id: 'c1', name: 'read', state: 'settled', step: 1 },
      { kind: 'reasoning', id: 'a1:r0', chars: 3, preview: '想一想', step: 1 },
    ])
    // 两条回复都在；「最后那段话」是第几条由 `finalReplyOf` 判（下一节）。
    expect(turn.replies.map(reply => reply.text)).toEqual(['途中说一句', '最后那段话'])
    expect(turn.endedAt).toBe(2000)
    expect(turn.endReason).toBe('completed')
    /* 最终回答边界也在这里算好了（官方判据）：最后一步里带文字、且那一步没有工具
       调用 → 第 2 步的「最后那段话」，它之前那条回复算过程（`messageCount` 1）。 */
    expect(turn.answer).toEqual({ step: 2, replyId: 'a2', messageCount: 1 })
    /* 到达次序贯穿过程与回复：工具 1 → 思考 2 → 回复 3 → 回复 4，画的时候按它排。 */
    expect([...turn.steps, ...turn.replies].map(one => one.order)).toEqual([1, 2, 3, 4])
  })

  it('轮里的注入是过程，不是读者的话', () => {
    const events: TranscriptEvent[] = [
      { ...base, seq: 1, type: 'turn/start', data: { turn: 1 } },
      userMessage('c1', 'Current runtime context…', 'time-context', { form: 'snapshot' }),
      userMessage('m1', '真正的问题'),
    ]
    const [turn] = foldTurns(events)
    expect(turn.trigger).toMatchObject({ text: '真正的问题' })
    expect(turn.steps).toMatchObject([
      { kind: 'context', id: 'c1', producer: 'time-context', summary: '', at: 1000 },
    ])
  })

  it('读者中途插话进 interjections——那一轮因此永不折', () => {
    const events: TranscriptEvent[] = [
      { ...base, seq: 1, type: 'turn/start', data: { turn: 1 } },
      userMessage('m1', '第一句'),
      assistant(1, 1, 'a1', [{ type: 'text', text: '好的' }]),
      userMessage('m2', '顺便再问一句'),
    ]
    const [turn] = foldTurns(events)
    expect(turn.trigger).toMatchObject({ id: 'm1' })
    expect(turn.interjections.map(one => one.text)).toEqual(['顺便再问一句'])
  })

  it('窗口切掉轮头时，用助手消息自带的轮号合成一组——不吞内容', () => {
    const events: TranscriptEvent[] = [
      assistant(7, 3, 'a1', [{ type: 'text', text: '这轮的后半段' }]),
      { ...base, seq: 2, type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } } },
    ]
    const turns = foldTurns(events)
    expect(turns).toHaveLength(1)
    expect(turns[0].turn).toBe(7)
    expect(turns[0].trigger).toBeUndefined()
    expect(turns[0].replies.map(reply => reply.text)).toEqual(['这轮的后半段'])
  })

  it('有调用没结果：轮已结束说 unsettled，还在跑说 running——不谎称失败', () => {
    const ended: TranscriptEvent[] = [
      { ...base, seq: 1, type: 'turn/start', data: { turn: 1 } },
      { ...base, seq: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'bash' } },
      { ...base, seq: 3, time: 2000, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    expect(foldTurns(ended)[0].steps[0]).toMatchObject({ kind: 'tool', state: 'unsettled' })
    const running: TranscriptEvent[] = [
      { ...base, seq: 1, type: 'turn/start', data: { turn: 1 } },
      { ...base, seq: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'bash' } },
    ]
    expect(foldTurns(running)[0].steps[0]).toMatchObject({ kind: 'tool', state: 'running' })
  })

  it('思考只留字数与首行（正文不进折行）', () => {
    const blocks = [{ type: 'reasoning', text: '第一行想法\n第二行不该出现' }]
    expect(reasoningOf(blocks)).toEqual([{ chars: 13, preview: '第一行想法' }])
    const long = reasoningOf([{ type: 'reasoning', text: 'x'.repeat(200) }])
    expect(long[0].preview.length).toBe(81)
    expect(long[0].preview.endsWith('…')).toBe(true)
  })

  it('空内容与无关事件都不产生轮', () => {
    expect(foldTurns([])).toEqual([])
    expect(foldTurns([{ ...base, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }][0] === undefined ? [] : [])).toEqual([])
    const empty: TranscriptEvent[] = [
      { ...base, seq: 1, type: 'turn/start', data: { turn: 1 } },
      { ...base, seq: 2, type: 'user/message', data: { id: 'm1', role: 'user', content: [], source: { kind: 'user' } } },
    ]
    /* 开过的轮留在列表里（它真的发生过），但没有触发句、没有回复。 */
    expect(foldTurns(empty)).toEqual([{ turn: 1, interjections: [], steps: [], replies: [] }])
  })

  it('图片按耐久 ref 去重，纯图片消息照样成条', () => {
    const events: TranscriptEvent[] = [
      { ...base, seq: 1, type: 'turn/start', data: { turn: 1 } },
      {
        ...base,
        seq: 2,
        type: 'user/message',
        data: {
          id: 'm1',
          role: 'user',
          source: { kind: 'user' },
          content: [
            /* 官方 `ImageAttachmentRef` 的 required 集合：ID + 格式 + 字节数 + 宽高。
               少了任何一项，读图那扇门就会按契约拒掉——所以折叠这一层要求整份。 */
            { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 100, width: 4, height: 3, name: 'a.png' } },
            /* 同一个 ID 的第二次出现：去重（一条消息里同一张图只算一张）。 */
            { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 100, width: 4, height: 3 } },
            /* 缺字段的那一张：跳过，而不是发一份注定被拒的引用。 */
            { type: 'image', attachment: { attachmentId: 'att-2', mediaType: 'image/png' } },
          ],
        },
      },
    ]
    const [turn] = foldTurns(events)
    expect(turn.trigger?.text).toBe('')
    expect(turn.trigger?.images).toEqual([{ attachmentId: 'att-1', mediaType: 'image/png', bytes: 100, width: 4, height: 3, name: 'a.png' }])
  })

  it('sumUsage 遍历每一轮里的回复', () => {
    const events: TranscriptEvent[] = [
      { ...base, seq: 1, type: 'turn/start', data: { turn: 1 } },
      assistant(1, 1, 'a1', [{ type: 'text', text: '1' }], { inputTokens: 10, outputTokens: 5 }),
      assistant(1, 2, 'a2', [{ type: 'text', text: '2' }], { inputTokens: 4, outputTokens: 1, cacheWriteTokens: 7, reasoningTokens: 2 }),
    ]
    expect(sumUsage(foldTurns(events))).toEqual({
      inputTokens: 14,
      outputTokens: 6,
      cacheWriteTokens: 7,
      reasoningTokens: 2,
    })
    expect(sumUsage(foldTurns([{ ...base, seq: 1, type: 'turn/start', data: { turn: 1 } }]))).toBeUndefined()
  })
})

describe('contextOccupancy / contextSegments / formatTokens', () => {
  it('computes the native percentage (rounded, clamped at 100)', () => {
    expect(contextOccupancy({ projectedTokens: 639_000, contextWindow: 1_000_000 }))
      .toEqual({ percent: 64, usedTokens: 639_000, contextWindow: 1_000_000 })
    expect(contextOccupancy({ projectedTokens: 2_000_000, contextWindow: 1_000_000 })?.percent).toBe(100)
    expect(contextOccupancy({ projectedTokens: 0, contextWindow: 1_000_000 })?.percent).toBe(0)
  })

  it('prefers projectedTokens and falls back to the bare provider sample', () => {
    expect(contextOccupancy({ pressureTokens: 100, contextWindow: 1_000 })?.usedTokens).toBe(100)
    expect(contextOccupancy({ pressureTokens: 100, projectedTokens: 250, contextWindow: 1_000 })?.usedTokens).toBe(250)
  })

  it('returns undefined until both a numerator and a capacity are known', () => {
    expect(contextOccupancy(undefined)).toBeUndefined()
    expect(contextOccupancy({})).toBeUndefined()
    expect(contextOccupancy({ pressureTokens: 100 })).toBeUndefined()
    expect(contextOccupancy({ contextWindow: 1_000 })).toBeUndefined()
  })

  it('falls back to one uncolored full-width segment without a breakdown', () => {
    const occupancy = { percent: 50, usedTokens: 500, contextWindow: 1_000 }
    expect(contextSegments(occupancy, undefined)).toEqual([{ key: 'total', className: undefined, width: 50 }])
  })

  it('splits the bar into colored segments by the breakdown composition', () => {
    const occupancy = { percent: 50, usedTokens: 500, contextWindow: 1_000 }
    const segments = contextSegments(occupancy, { systemTokens: 100, toolsTokens: 200, messageTokens: 300 })
    expect(segments).toEqual([
      { key: 'systemTokens', className: 'meterSystem', width: 50 * (100 / 600) },
      { key: 'toolsTokens', className: 'meterTools', width: 50 * (200 / 600) },
      { key: 'messageTokens', className: 'meterMessages', width: 50 * (300 / 600) },
    ])
  })

  it('drops buckets that contribute no tokens (including an all-empty breakdown)', () => {
    const occupancy = { percent: 50, usedTokens: 500, contextWindow: 1_000 }
    const segments = contextSegments(occupancy, { systemTokens: 0, toolsTokens: 0, messageTokens: 100 })
    expect(segments).toEqual([{ key: 'messageTokens', className: 'meterMessages', width: 50 }])
    expect(contextSegments(occupancy, { systemTokens: 0, toolsTokens: 0, messageTokens: 0 }))
      .toEqual([{ key: 'total', className: undefined, width: 50 }])
  })

  it('matches the native compact formatting (K/M with one decimal under 100)', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_000)).toBe('1K')
    expect(formatTokens(4_600)).toBe('4.6K')
    expect(formatTokens(16_800)).toBe('16.8K')
    expect(formatTokens(99_999)).toBe('100K')
    expect(formatTokens(465_000)).toBe('465K')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(2_500_000)).toBe('2.5M')
  })

  it('formats the decode rate whole (figure only, unit rides the locale)', () => {
    expect(formatTps(253_000, 1_000_000)).toBe('253')
    expect(formatTps(0, 1_000)).toBe('0')
    // No measurable window: the fragment hides instead of printing `0 tok/s`.
    expect(formatTps(100, 0)).toBeUndefined()
    expect(formatTps(100, -5)).toBeUndefined()
  })

  it('computes the cache hit rate over all input (rounded, whole percent)', () => {
    // The official 95% shape: 50,350,059 read over 2,455,146 uncached + read.
    expect(cacheHitRate(50_350_059, 2_455_146)).toBe('95')
    expect(cacheHitRate(0, 1_000)).toBe('0')
    // No input measured: the line hides instead of printing NaN.
    expect(cacheHitRate(0, 0)).toBeUndefined()
  })
})

describe('shouldFlipMenuUp', () => {
  /** A field 40px tall inside a 600px-tall modal. */
  const field = { top: 520, bottom: 560 }
  const modal = { top: 100, bottom: 700 }
  const VIEWPORT = 900

  it('keeps the default downward opening when there is enough room below', () => {
    // 140px below the field — less than the 284px needed (menu 280 + gap 4).
    expect(shouldFlipMenuUp(field, modal, VIEWPORT)).toBe(true)
    const roomyField = { top: 200, bottom: 240 }
    expect(shouldFlipMenuUp(roomyField, modal, VIEWPORT)).toBe(false)
  })

  it('opens upward when the bottom of the modal clips the menu', () => {
    // Field flush with the modal's bottom edge: nothing below, everything
    // above → flip.
    const flush = { top: 660, bottom: 700 }
    expect(shouldFlipMenuUp(flush, modal, VIEWPORT)).toBe(true)
  })

  it('does not flip when both directions clip (downward stays the default)', () => {
    // 100px of modal above and 40px below: above > below, so it flips
    // (the better of two bad options).
    const squeezed = { top: 200, bottom: 660 }
    expect(shouldFlipMenuUp(squeezed, modal, VIEWPORT)).toBe(true)
    // Truly symmetric: more room below than above → keep downward even
    // though it clips.
    const asymmetric = { top: 120, bottom: 680 }
    expect(shouldFlipMenuUp(asymmetric, modal, VIEWPORT)).toBe(false)
  })

  it('falls back to viewport judgment without a clipping ancestor', () => {
    // No modal: the viewport bottom is the boundary.
    const nearBottom = { top: 820, bottom: 860 }
    expect(shouldFlipMenuUp(nearBottom, undefined, VIEWPORT)).toBe(true)
    const middle = { top: 300, bottom: 340 }
    expect(shouldFlipMenuUp(middle, undefined, VIEWPORT)).toBe(false)
  })

  it('respects a custom menu height', () => {
    // 140px below the field: a short menu fits, a tall one flips.
    expect(shouldFlipMenuUp(field, modal, VIEWPORT, 120)).toBe(false)
    expect(shouldFlipMenuUp(field, modal, VIEWPORT, 200)).toBe(true)
  })
})

describe('latestSessionTodos (session live to-do readout)', () => {
  it('reads the newest todo/write snapshot (last write wins)', () => {
    const events = [
      { type: 'todo/write', seq: 1, data: { todos: [{ content: '旧', status: 'pending' }] } },
      { type: 'todo/write', seq: 2, data: { todos: [{ content: '新', status: 'in_progress' }, { content: '完成', status: 'completed' }] } },
    ]
    const todos = latestSessionTodos(events)
    expect(todos?.map(row => row.content)).toEqual(['新', '完成'])
    expect(isOpenTodo(todos![0])).toBe(true)
    expect(isOpenTodo(todos![1])).toBe(false)
  })

  it('returns undefined when the session never wrote a todo', () => {
    expect(latestSessionTodos([{ type: 'user/message', data: { id: 'm' } }])).toBeUndefined()
    expect(latestSessionTodos([])).toBeUndefined()
  })

  it('drops malformed rows and normalizes unknown statuses to pending', () => {
    const todos = latestSessionTodos([
      { type: 'todo/write', seq: 1, data: { todos: [{ content: '', status: 'x' }, { content: 'ok', status: 'weird' }, 'junk'] } },
    ])
    expect(todos).toEqual([{ content: 'ok', status: 'pending' }])
  })
})

describe('contextWorthOf (show only UNFINISHED context)', () => {
  const allDone = { todos: [{ content: 'a', status: 'completed' as const }, { content: 'b', status: 'completed' as const }] }

  it('hides a fully-completed todo list (the all-done still shows bug)', () => {
    expect(contextWorthOf(allDone)).toBe(false)
    expect(contextWorthOf({ todos: [] })).toBe(false)
    expect(contextWorthOf({})).toBe(false)
  })

  it('shows when any todo is still open, and keeps the done rows as progress context', () => {
    expect(contextWorthOf({ todos: [{ content: 'a', status: 'completed' as const }, { content: 'b', status: 'pending' as const }] })).toBe(true)
    expect(contextWorthOf({ todos: [{ content: 'a', status: 'in_progress' as const }] })).toBe(true)
  })

  it('shows only an ACTIVE goal; a non-active/completed goal is finished business', () => {
    expect(contextWorthOf({ goal: { active: true } })).toBe(true)
    expect(contextWorthOf({ goal: { active: false } })).toBe(false)
  })

  it('shows unfinished subagents; finished ones hide; an unknown status is treated as active', () => {
    expect(contextWorthOf({ subagents: [{ title: 'w', status: 'running' }] })).toBe(true)
    expect(contextWorthOf({ subagents: [{ title: 'w' }] })).toBe(true)
    expect(contextWorthOf({ subagents: [{ title: 'w', status: 'finished' }] })).toBe(false)
    expect(contextWorthOf({ subagents: [{ title: 'w', status: 'done' }] })).toBe(false)
    // The native activity word the host bridge maps ('inactive' = finished).
    expect(contextWorthOf({ subagents: [{ title: 'w', status: 'inactive' }] })).toBe(false)
  })
})

describe('session context panel row grammar (badge never spills over the text)', () => {
  function ruleOf(name: string): string {
    const lines = renderedSource.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== `.${name} {`) continue
      let depth = 0
      const chunks: string[] = []
      for (let j = i; j < lines.length; j++) {
        const line = lines[j]
        chunks.push(line)
        for (const ch of line) {
          if (ch === '{') depth++
          else if (ch === '}') {
            depth--
            if (depth === 0) return chunks.join('\n')
          }
        }
      }
    }
    throw new Error(`rule ".${name}" not found in board.module.css`)
  }

  const tsxPath = fileURLToPath(new URL('../src/client/board/SessionContextBlock.tsx', import.meta.url))
  const tsxSource = readFileSync(tsxPath, 'utf8')

  it('the badge rides the FIRST text line (never centered over a multi-line block)', () => {
    expect(ruleOf('sessionContextRow')).toContain('align-items: flex-start')
    expect(ruleOf('sessionContextRow')).not.toContain('align-items: center')
  })

  it('the badge chip never shrinks below its label (a squeezed box would overflow)', () => {
    expect(ruleOf('sessionContextGoalOn')).toContain('flex: none')
    expect(ruleOf('sessionContextSubagent')).toContain('flex: none')
  })

  it('the badge label rides the shared Chip two-slot grammar, never a naked .chip', () => {
    // The goal/subagent badges must flow through <Chip> (label into .chipBody,
    // ellipsis instead of overflow); a naked css.chip + nowrap is the root
    // cause of the label spilling over the goal paragraph.
    expect(tsxSource).toContain('<Chip fill={false} className={css.sessionContextGoalOn}>')
    expect(tsxSource).toContain('<Chip fill={false} className={css.sessionContextSubagent}>')
    expect(tsxSource).not.toContain('`${css.chip}')
  })

  it('the goal row is the interactive strip when verbs are served (official GoalBar grammar)', () => {
    // 暂停/开启/修改/删除 ride the official `remote.goals` verbs with the
    // call-time CAS ref; the legacy read-only row stays only for hosts
    // without the face. The strip mirrors GoalBar: complete/cleared render
    // nothing, one action at a time, failures inline.
    expect(tsxSource).toContain('<GoalStrip')
    expect(tsxSource).toContain('controller.goalVerbs(sessionId)')
    const stripPath = fileURLToPath(new URL('../src/client/board/goal-strip.tsx', import.meta.url))
    const strip = readFileSync(stripPath, 'utf8')
    expect(strip).toContain('clearedGoalId')
    expect(strip).toContain("phase === 'complete'")
    expect(strip).toContain('pendingRef')
    expect(strip).toContain('verbs.pause')
    expect(strip).toContain('verbs.resume')
    expect(strip).toContain('verbs.clear')
    expect(strip).toContain('verbs.edit')
    expect(ruleOf('goalStrip')).toContain('flex-wrap: wrap')
    expect(ruleOf('goalStripActions')).toContain('flex: none')
  })
})

/**
 * THE 3-SECOND POLL MUST BE A NO-OP WHEN NOTHING MOVED.
 *
 * `useSessionContext` re-reads the transcript every 3 seconds for as long as a
 * session panel is open. Its result was committed with a fresh object literal each
 * time, so React saw a new reference and re-rendered the whole panel — `SessionDetail`
 * and `ReviewDetail` are both consumers, and both are the entire visible surface.
 *
 * A reader scrolling while one of those lands feels one stuck frame: 「滑动条一抽一抽」.
 * It never depended on content length, which is why 「其他 session 也卡」 and why the
 * board's columns (no polling) never did.
 *
 * This checks the shape of the write rather than running timers: the updater must
 * compare before committing. A future refactor that goes back to returning a fresh
 * object unconditionally would silently restore the stutter, so the assertion is on
 * the comparator's presence in each polling updater.
 */
describe('the session poll does not re-render when nothing changed', () => {
  const hookPath = fileURLToPath(new URL('../src/client/board/use-interaction.ts', import.meta.url))
  const hook = readFileSync(hookPath, 'utf8')

  it('both polling updaters compare before committing', () => {
    // Each `setContext` in this hook that builds a value must return `current`
    // when the built value is equal.
    const updaters = hook.match(/setContext\(current =>[\s\S]*?\n      \}\)/g) ?? []
    expect(updaters.length, 'the polling updaters must be findable').toBeGreaterThan(0)
    for (const updater of updaters) {
      if (!updater.includes('const next')) continue
      expect(updater, 'a polling updater builds an object without comparing it')
        .toMatch(/JSON\.stringify\(next\) === JSON\.stringify\(current\) \? current : next/)
    }
  })

  it('no polling updater commits an unconditional fresh object', () => {
    // The original defect, stated as a ban: `setContext(current => ({ ...current,`
    // followed directly by a commit is exactly the shape that stuttered.
    expect(hook, 'a poll commits a fresh object every cycle — that re-renders the whole panel')
      .not.toMatch(/setContext\(current => \(\{\s*\n\s*\.\.\.current,/)
  })
})

/**
 * 周期性的投影提交必须去重——这是同一个病根的第二、三处。
 *
 * `useTranscriptTail` 每 3 秒回一次结果，而 `setProjections(result.projections)`
 * 拿到的是**每次全新的对象**。setState 按引用比较，所以哪怕投影内容一个字没变，
 * 每 3 秒也必然重渲染一次整个面板（SessionDetail 211 行、零处 useMemo）。
 * 滚动撞上那一刻就是一卡——「滑动条一抽一抽」。
 *
 * 第一处（useSessionContext）上一轮修过；这两处是当时漏掉的，所以这里一并钉住：
 * 三个周期性的 setState 都必须先按值比较。
 */
describe('periodic projection commits are deduplicated', () => {
  const read = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(`../src/client/board/${rel}`, import.meta.url)), 'utf8')

  for (const file of ['SessionDetail.tsx', 'ReviewDetail.tsx']) {
    it(`${file} commits projections only when they changed`, () => {
      const source = read(file)
      // The defect, stated as a ban: a bare commit of a fresh object from the poll.
      expect(source, 'the projection commit takes the poll result straight into setState — that re-renders the panel on a timer')
        .not.toMatch(/\(result\) => \{ setProjections\(result\.projections\) \}/)
      // And the fix must be present in the shape that compares first.
      expect(source, 'the projection commit must compare before storing')
        .toMatch(/setProjections\(current => JSON\.stringify\(current\) === JSON\.stringify\(next\) \? current : next\)/)
    })
  }
})

/**
 * 「滑到最新」按钮到底时必须**留在布局里**，只可以失去墨与可点性。
 *
 * 它是一个真实占据滚动内容空间的东西（absolute、26px 高）。到底时 `return null` 把它从
 * DOM 摘掉，内容总高当场少掉它自己那一截——而那正好是读者刚抵达末尾的时刻，浏览器于是
 * 重新夹一次 scrollTop，画面就弹几像素。两处滚动区都渲染同一个组件，所以两处都弹。
 *
 * 这条测试钉的是「不卸载」这个决定本身：把 `return null` 加回去，它必须变红。
 *
 * 它同时钉住**它从哪里拿那个布尔值**：`TailPill` 读的是 pin 的订阅，不是面板的
 * `useState`。这一条与「滚动不重画」是同一件事的两面——值若经 props 从面板传下来，
 * 面板就得为此重画一次。
 */
describe('the jump-to-latest control keeps its layout space at the end', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/client/board/use-transcript.tsx', import.meta.url)), 'utf8')
  const body = /function TailPill\(\{ pin \}[\s\S]*?\n\}/.exec(source)?.[0] ?? ''

  it('the component is never unmounted on the atBottom branch', () => {
    expect(body, 'TailPill not found').not.toBe('')
    // The defect: bailing out before the element exists.
    expect(body, 'returning null at the end removes its height from the content and re-clamps the scroller')
      .not.toMatch(/if \(atBottom\) return null/)
  })

  it('it becomes inert instead, so a hidden control is neither seen nor reachable', () => {
    expect(body, 'the hidden state must be expressed, not unmounted').toMatch(/data-hidden=\{atBottom \? 'true' : undefined\}/)
    expect(body, 'a control nobody can see must not be clickable').toMatch(/disabled=\{atBottom\}/)
    expect(body, 'and it must leave the accessibility and tab order').toMatch(/aria-hidden=\{atBottom\}/)
  })

  it('it reads the pin through a subscription, not through panel state', () => {
    // A prop drilled from the panel would re-render the panel on every crossing;
    // that is exactly the cost this surface was paying.
    expect(body, 'the pill must subscribe to the pin instead of receiving a boolean').toMatch(/useSyncExternalStore\(pin\.subscribe, pin\.visible\)/)
  })

  it('it is reachable only through its frame', () => {
    // The pill is `absolute`, and its containing block must be the frame that does
    // not scroll. Exporting the pill alone invites rendering it inside a scroller —
    // which is the measured defect, not a style preference.
    expect(source, 'TailPill must stay private; TailFrame is the way in').not.toMatch(/export function TailPill/)
    expect(source, 'the frame must render the pill').toMatch(/<TailPill pin=\{pin\} \/>/)
  })
})

/**
 * 会话滚动区可以要 \`contain: layout\`，绝不可以要 \`contain: paint\`。
 *
 * 这不是风格偏好，是这个仓库里踩过的一次事故：\`contain: layout paint\` 曾放在看板
 * 列上，headless 量出中性所以发了出去；真实笔记本 + 外接高分屏上，\`paint\` 让这个
 * 盒子成为独立的绘制包含块，每次滚动都重新合成一层，手势跟不上滚轮，最后撤回
 * （记录在 board.module.css 那条回归注释里）。
 *
 * \`layout\` 只建立布局边界，不动绘制路径，所以它拿得到布局的收益而不付那笔代价。
 * 这条测试把那个区分钉住：以后谁想顺手把 \`paint\` 加回来，必须在这里先红一次。
 */
describe('the session scrollers bound layout, never paint', () => {
  const sheet = readFileSync(fileURLToPath(new URL('../src/client/board.module.css', import.meta.url)), 'utf8')
  /* The rule body WITHOUT its comments.
     The prose in this file legitimately NAMES the forbidden value while explaining
     why it is forbidden, so a judgement that reads text rather than structure
     would force that explanation to be deleted (rule 14). Strip comments, then
     judge declarations. */
  const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')
  const ruleOf = (name: string): string => {
    const at = sheet.indexOf(`.${name} {`)
    if (at < 0) throw new Error(`rule .${name} not found`)
    let depth = 0
    for (let i = sheet.indexOf('{', at); i < sheet.length; i += 1) {
      if (sheet[i] === '{') depth += 1
      if (sheet[i] === '}') { depth -= 1; if (depth === 0) return stripComments(sheet.slice(at, i + 1)) }
    }
    throw new Error(`rule .${name} unterminated`)
  }

  for (const name of ['commentsScroll', 'reviewTranscriptScroll']) {
    it(`.${name} contains layout and not paint`, () => {
      const rule = ruleOf(name)
      expect(rule, `.${name} must bound its layout work to itself`)
        .toMatch(/contain:\s*layout\s*;/)
      expect(rule, `.${name} must not contain paint — that is the mechanism the regression note names as the cost on high-DPI hardware`)
        .not.toMatch(/contain:[^;]*\bpaint\b/)
    })
  }
})

/**
 * 评论列表与「是否在底部」的判定，都不许在滚动/父级重渲染时做重复工作。
 *
 * 依据是一次**真实的性能录制**（读者提供的 Performance 轨迹）：INP 286ms（正常低于
 * 200ms），主线程 JS 块几乎铺满整段录制。两条各自的成因：
 *
 * 1. `atBottom` 用**单一 24px 阈值**判定。读者停在底部附近时，滚轮每动一格都会跨过
 *    那条线，于是 `atBottom` 反复翻转，整个面板（列表、输入框、折叠状态）跟着重渲染
 *    —— 一次手势一次重渲染。修法是**迟滞**：进底部 24px，离开要 120px。
 * 2. `CommentsThread` 没有 memo。父级每 3 秒轮询、状态行更新、折叠切换都会重画整个
 *    评论列表（每条一个 `<li>`，内含 markdown、芯片、附件簿记）。修法是按内容 memo
 *    ——按**值**比较轮次 id 与状态，因为 props 本身在上游每次都是新对象。
 */
describe('the comment surface does no per-scroll or per-poll rework', () => {
  const boardDir = fileURLToPath(new URL('../src/client/board/', import.meta.url))
  const read = (name: string): string => readFileSync(boardDir + name, 'utf8')

  it('the pill keeps hysteresis, and the FOLLOW gate does not use it', () => {
    const hook = read('use-transcript.tsx')
    expect(hook, 'a second, larger threshold must exist for showing the pill')
      .toMatch(/LEAVE_BOTTOM_PX\s*=\s*\d+/)
    // The defect, stated as a ban: one threshold for both directions makes the
    // pill flicker — and, before it was a subscription, re-rendered the panel.
    const measure = /const measure = useCallback\(\(\): void => \{[\s\S]*?\n  \}, \[publish\]\)/.exec(hook)?.[0] ?? ''
    expect(measure, 'measure not found').not.toBe('')
    expect(measure, 'a single-threshold comparison toggles the pill on every crossing')
      .not.toMatch(/const next = root\.scrollHeight - root\.scrollTop - root\.clientHeight < NEAR_BOTTOM_PX/)
    /* THE PILL'S THRESHOLD DEPENDS ON ITS OWN PREVIOUS ANSWER — that IS the
     * hysteresis, and it has to be read from the live value rather than captured,
     * otherwise every measurement would use the same side of the fork. */
    expect(measure, 'the pill must pick its threshold from its current visibility')
      .toMatch(/visibleRef\.current \? distance >= LEAVE_BOTTOM_PX : distance >= NEAR_BOTTOM_PX/)
    /* AND THE TWO ANSWERS MUST NOT BE ONE.
     *
     * 「还要不要跟随」 is asked every frame and must be a subtraction; 「胶囊该不该显示」
     * is a visual fact with a 120px leave-line. Sharing the leave-line would leave a
     * reader who scrolled 100px up still 「在底部」 — so an arriving round would pull
     * them back to the end mid-read. */
    expect(hook, 'the follow gate needs its own, tighter line').toMatch(/FOLLOW_SLACK_PX\s*=\s*\d+/)
    expect(measure, 'the follow gate must be set from its own line, not from the pill hysteresis')
      .toMatch(/pinnedRef\.current = distance < FOLLOW_SLACK_PX/)
  })

  it('no scroll event can re-render the panel', () => {
    const hook = read('use-transcript.tsx')
    // The mechanism, stated as a structure: the pin's two answers live in refs, and
    // the only thing that hears about a crossing is the pill's subscription.
    const follow = /export function useFollowScroll\([\s\S]*?\n  return \{ subscribe, visible, jump, hold \}\n\}/.exec(hook)?.[0] ?? ''
    expect(follow, 'useFollowScroll not found').not.toBe('')
    expect(follow, 'scroll state must not live in React state — every crossing would re-render the panel')
      .not.toMatch(/useState/)
    expect(follow, 'the pin is a ref, written on every measure')
      .toMatch(/const pinnedRef = useRef\(true\)/)
    expect(follow, 'the pill hears about a crossing through a subscription')
      .toMatch(/const subscribe = useCallback\(/)
    // The fold is derived once per window, so its result is reference-stable and the
    // memo on TurnList/TurnItem can actually hit.
    expect(hook, 'foldTurns must be memoised on the window (otherwise every render refolds and every row re-renders)')
      .toMatch(/const turns = useMemo\(\(\) => \(events === undefined \? undefined : foldTurns\(events\)\), \[events\]\)/)
  })

  it('the comment thread is memoised on its content', () => {
    const source = read('CommentsThread.tsx')
    expect(source, 'CommentsThread must be wrapped in memo — every parent render otherwise repaints every comment')
      .toMatch(/export const CommentsThread = memo\(function CommentsThread/)
    // Identity comparison would never hit: `views` is a fresh array each poll.
    expect(source, 'the comparison must be by value, not object identity')
      .toMatch(/x\.round\.id !== y\.round\.id \|\| x\.state !== y\.state/)
    /* AND THE MEMO MUST BE ABLE TO HIT.
     *
     * The comparator checks `onCancel` by identity FIRST, so an inline arrow at the
     * call site made that memo miss on every parent render since the day it was
     * written — and the parent re-renders on a 3-second poll. The whole thread
     * (markdown trees, chips, attachment arithmetic) was rebuilt each time, which is
     * what the reader felt as scroll jank on the comment surface.
     *
     * So the handler now comes from the rail's own `useCallback`, and the call site
     * takes no handler at all: there is nothing left to remember to stabilise. */
    expect(read('session-panel.tsx'), 'the rail must own the cancel handler (one stable reference per controller)')
      .toMatch(/const cancelComment = useCallback\(\s*\(roundId: string\): boolean => controller\.cancelComment\(roundId\),\s*\[controller\]/)
    expect(read('session-panel.tsx'), 'the call site must not pass a handler that could be rebuilt each render')
      .not.toMatch(/onCancelComment/)
  })

  /* 同一族的第二个漏点：`TurnItem` 收着每项现场新建的箭头，它的 memo 也一样失效。
   * 判据看的是**形状**：那一项收到的必须是「键 + 稳定函数」，不许是 `() => …`。 */
  it('the turn rows receive stable props too', () => {
    const source = read('TurnItem.tsx')
    const itemTag = /<TurnItem[\s\S]*?\/>/.exec(source)?.[0] ?? ''
    expect(itemTag, 'the TurnItem call site was not found').not.toBe('')
    expect(itemTag, 'an inline arrow here defeats TurnItem\'s memo on every list render')
      .not.toMatch(/onToggle=\{\(\)\s*=>/)
    expect(itemTag, 'the stable handler is passed straight through').toMatch(/onToggle=\{props\.onToggle\}/)
    // The policy object is rebuilt each render unless it is memoised on `prefs`
    // (which `useSyncExternalStore` hands over as a stable reference).
    expect(source, 'a fresh policy object per render defeats TurnItem\'s memo just as surely')
      .toMatch(/const policy = useMemo\(\(\) => policyOfWorkSteps\(props\.prefs\), \[props\.prefs\]\)/)
  })
})

/**
 * 滚动路径上一个布局属性都不许读。
 *
 * ── 依据 ──────────────────────────────────────────────────────────────────────
 *
 * 读者提供的两次真实 Performance 录制里，最能说明问题的是这一项：**未归因主线程
 * 耗时 5,051ms**（占比最大），同期渲染 2,031ms、绘制 1,508ms。「未归因」是 Chrome
 * 无法归到任何函数的强制重排——不是任何一个回调慢，而是主线程一直在被要求把布局
 * 做完。
 *
 * 来源是这段判定：
 *
 *     root.scrollHeight - root.scrollTop - root.clientHeight
 *
 * `scrollHeight` 与 `clientHeight` 是**布局读取**：问它们会让引擎先把所有待处理的
 * 样式与布局算完。每帧问一次，主线程就永远追不上合成器。而 `scrollTop` 只是已存的
 * 一个偏移，读它不触发布局。
 *
 * 所以这条钉的是结构：**`measure` 里只许出现 `scrollTop`**，昂贵的那两个值来自
 * 缓存，缓存在几何真的会变的地方（挂载、内容尺寸变化、区域重建）刷新。滚动不是
 * 几何变化。
 */
describe('the scroll path reads no layout', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/client/board/use-transcript.tsx', import.meta.url)), 'utf8')

  it('measure reads only scrollTop, and never resolves the scroller', () => {
    const measure = /const measure = useCallback\(\(\): void => \{[\s\S]*?\n  \}, \[publish\]\)/.exec(source)?.[0] ?? ''
    expect(measure, 'measure not found').not.toBe('')
    expect(measure, 'scrollHeight forces a layout pass — reading it per frame is what saturated the main thread')
      .not.toMatch(/\.scrollHeight/)
    expect(measure, 'clientHeight forces a layout pass too')
      .not.toMatch(/\.clientHeight/)
    /* AND IT MUST NOT RESOLVE THE SCROLLER EITHER.
     *
     * `resolveScroller` walks the ancestors calling `getComputedStyle`, which forces
     * a style recalculation. Called from the per-frame path it is the SAME defect as
     * reading `scrollHeight`: the main thread can never get ahead, and because it
     * only costs when the styles are actually dirty, the result is jank that comes
     * and goes — 「有时候掉帧有时候又还好」. Measured before the fix
     * (`scripts/probes/probe-follow-cost.{cjs,js}`): 40 frames of scrolling produced
     * 40 style resolutions. After: 0.
     *
     * The root is resolved once per layout change instead, and the per-frame path
     * reads it from a ref. */
    expect(measure, 'resolving the scroller on the scroll path forces a style recalculation every frame')
      .not.toMatch(/resolveScroller|getComputedStyle/)
    expect(measure, 'the scroller must come from the ref the owner keeps').toMatch(/rootRef\.current/)
    expect(measure, 'the answer must come from the cached geometry').toMatch(/geometry\.current/)
    expect(measure, 'scrollTop is the only scroll property that is safe to read here').toMatch(/\.scrollTop/)
  })

  it('the geometry cache is refreshed off the scroll path, through one read', () => {
    // It has to be filled somewhere, or the measurement is meaningless: on setup, on
    // a resize notification, and whenever content arrives.
    //
    // The read itself exists in exactly ONE function — `geometryOf` — so that "who
    // may pay for a layout read" is a question with one answer in the file rather
    // than a rule every future editor has to remember.
    expect(source, 'the layout read must live in one named helper')
      .toMatch(/function geometryOf\(root: HTMLElement\): \{ height: number; max: number \}/)
    expect(source, 'the cache must be filled through that helper')
      .toMatch(/geometry\.current = geometryOf\(root\)/)
    expect(source, 'a ResizeObserver must keep it current as content grows').toMatch(/new ResizeObserver/)
    // …and nowhere else reads that geometry: one helper, and inside it the two
    // property reads happen once. `height` is read once and reused, so a future
    // edit cannot re-introduce a second `scrollHeight` by accident.
    //
    // COMMENTS ARE STRIPPED FIRST (hard rule 14): the long notes above explain the
    // property names, and a check that counted prose would force the explanation to
    // be deleted.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
    const a = code.match(/\.scrollHeight/g) ?? []
    const b = code.match(/\.clientHeight/g) ?? []
    expect(a.length, 'a second read of scrollHeight is a second place to forget it is expensive').toBe(1)
    expect(b.length, 'a second read of clientHeight is a second place to forget it is expensive').toBe(1)
  })

  it('one region has one observer and one listener', () => {
    // The shape that made this unmaintainable: two ResizeObservers over the same
    // element (each resize read the layout twice) and four separate writers of the
    // same `scrollTop`. The probe counts them on a real page
    // (`scripts/probes/probe-follow-cost`): 2 observers over 3 nodes before, 1 over
    // 1 after.
    const observers = source.match(/new ResizeObserver/g) ?? []
    expect(observers.length, 'a second observer over the same region reads the same layout twice').toBe(1)
    const listeners = source.match(/addEventListener\('scroll'/g) ?? []
    expect(listeners.length, 'a second scroll listener dispatches the same measurement twice').toBe(1)
    // One write path: the owner. Commands move the reader; nothing else does.
    const writes = source.split('\n').filter(line => /\.scrollTop\s*=/.test(line))
    expect(writes.length, 'a hand-rolled scrollTop write outside the owner is a second owner').toBeLessThanOrEqual(3)
  })

  it('the scroll listener itself does not read geometry', () => {
    // The listener schedules `measure`; the ban is on doing layout work in it.
    const listener = /\.addEventListener\('scroll', onScroll[\s\S]{0,400}/.exec(source)?.[0] ?? ''
    expect(listener, 'scroll listener not found').not.toBe('')
    expect(listener, 'the scroll listener must not read layout directly')
      .not.toMatch(/scrollHeight|clientHeight|getComputedStyle/)
  })
})

/**
 * 滚动容器内部不许有 `position: sticky` 元素。
 *
 * ── 依据 ──────────────────────────────────────────────────────────────────────
 *
 * 读者提供的两份 Performance 录制里，最大的一项始终是**未归因主线程耗时**
 * （5,051ms / 5,318ms），而「执行脚本」只有 1,325ms 左右。也就是说主线程绝大部分
 * 时间不是在跑 JS，而是在做引擎内部的布局工作。
 *
 * sticky 元素正是这种工作的来源：它要求引擎**在滚动的每一帧重新计算位置**，而且
 * 「看不见」不改变这一点——\`visibility: hidden\` 保留盒子，盒子仍要每帧被定位。
 * 一个滚动容器里只要有一个 sticky 子元素，滚动路径上就永远有布局参与者。
 *
 * 所以「滑到最新」那个角落按钮改成 absolute（贴着容器的定位边缘，布局一次即可）。
 * 这条钉的是结构：那两个会话滚动容器里，不许再出现 sticky。
 */
describe('no sticky element lives inside a session scroll container', () => {
  const sheet = readFileSync(fileURLToPath(new URL('../src/client/board.module.css', import.meta.url)), 'utf8')

  // Judge DECLARATIONS, not prose: the rule explains the old value by name, and a
  // text-reading check would force that explanation to be deleted (rule 14).
  const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  it('the jump affordance is absolutely positioned, not sticky', () => {
    const rule = stripComments(/\.reviewJumpLatest \{[\s\S]*?\n\}/.exec(sheet)?.[0] ?? '')
    expect(rule, 'the jump affordance rule not found').not.toBe('')
    expect(rule, 'a sticky element inside the scroller is repositioned on every scroll frame')
      .not.toMatch(/position:\s*sticky/)
    expect(rule, 'it must be absolutely positioned instead')
      .toMatch(/position:\s*absolute/)
  })

  it('its containing block is a frame OUTSIDE the scroller', () => {
    // 「绝对定位的子元素住在滚动容器里」看着对，实际会跟着内容滚走——`topInBox`
    // 在 scrollTop 0 处是 203，滚到一半是 -292，也就是说读者离开末尾、胶囊本该露面的
    // 那一刻它已经在屏幕外。量法在 `scripts/probes/probe-pill-anchor.{cjs,js}`。
    //
    // 所以包含块必须是滚动体**外面**那一层，而且那一层自己不许滚。
    /* `[^}]*` 而不是 `[\s\S]*?\n\}`：这个文件的规则体以 `;}` 收尾（分号与花括号同
       一行），用「换行 + }」找结束会越过本条一直吃到下一条，读到别人的 `position`。 */
    for (const cls of ['commentsScroll', 'reviewTranscriptScroll']) {
      const rule = stripComments(new RegExp(`\\.${cls} \\{[^}]*\\}`).exec(sheet)?.[0] ?? '')
      expect(rule, `.${cls} rule not found`).not.toBe('')
      expect(rule, `.${cls} must NOT establish a containing block for the pill — it scrolls, so the pill would ride it`)
        .not.toMatch(/position:\s*relative/)
    }
    const frame = stripComments(/\.sessionScrollFrame \{[^}]*\}/.exec(sheet)?.[0] ?? '')
    expect(frame, 'the frame rule not found').not.toBe('')
    expect(frame, 'the frame must be the containing block').toMatch(/position:\s*relative/)
    expect(frame, 'a scroller as the frame would put the pill back inside one').not.toMatch(/overflow/)
  })
})

/**
 * 面板盖住看板时，看板列必须**完全退出渲染**，而不只是被盖住。
 *
 * ── 依据 ──────────────────────────────────────────────────────────────────────
 *
 * 读者提供了三份 Performance 录制，每一份里最大的一项是「未归因主线程耗时」
 * （5,051 / 5,318 / 2,855 ms），而「执行脚本」只有 1,300 ms 左右。也就是说主线程
 * 绝大部分时间不在跑 JS，而在做引擎内部的布局与绘制。
 *
 * 结构上的原因是：看板列（`.columns`）与卡片详情面板是**兄弟**。面板用绝对定位盖在
 * 看板上，但看板**仍然留在布局树里、仍然被绘制**，还带着六个无限动画——读者在上面
 * 滚动评论区的整段时间里，它一直在被渲染。
 *
 * 修法不是逐个暂停动画（那是打补丁，每多一个动画就要多一条选择器），而是把要求说清：
 * `content-visibility: hidden` 让子树的**布局与绘制都不发生**，同时**保留盒子尺寸**，
 * 所以关掉面板时画面不会跳。
 *
 * 这条钉住三件事：用的是 content-visibility 而不是暂停动画；选择器指向列容器；条件
 * 由 :has() 表达而不是靠组件传标记。
 */

/**
 * 面板盖住看板时，看板列退出渲染——但**只许是那一个**。
 *
 * ── 为什么这条要写得这么细 ────────────────────────────────────────────────────
 *
 * 这个需求被做错过一次：上一版用类名后缀 `[class$='_columns']` 定位看板列，那个后缀在
 * 卡片详情面板**内部**也会命中，于是 `content-visibility: hidden` 把面板自己的内容连同
 * 背景一起从渲染里拿掉，读者看到的是「点开之后后面什么都没有了」。
 *
 * 所以下面钉的不是「有没有那条规则」，是两个必须同时成立的东西：
 *
 *   1. 定位只能用 `[data-dsh-tb-columns]`——那是本插件打在这个网格上的唯一稳定属性，
 *      全树只有一处；
 *   2. 判断只能来自 `:has([class*='modalBackdrop'])`，也就是「这个视图里有一个打开的
 *      遮罩」，它是从 DOM 事实读出来的，不是组件传下来的标记。
 *
 * 类名后缀 `_columns` 这种写法必须被禁止：它看起来更短，但它匹配的是**任意**以它结尾
 * 的类，包括面板内部的元素。
 */
describe('the covered board stops rendering, and only the board', () => {
  const sheet = readFileSync(fileURLToPath(new URL('../src/client/board.module.css', import.meta.url)), 'utf8')
  const declarations = sheet.replace(/\/\*[\s\S]*?\*\//g, ' ')

  it('the column grid is taken out of layout and paint', () => {
    expect(declarations, 'the covered board must stop being a render target')
      .toMatch(/\[data-dsh-taskboard-view\]:has\(\[class\*='modalBackdrop'\]\) \[data-dsh-tb-columns\] \{\s*content-visibility:\s*hidden;/)
  })

  it('it is located by the one stable attribute, never by a class suffix', () => {
    // The exact shape that blanked the panel last time.
    expect(declarations, 'a class-suffix selector also matches elements INSIDE the detail panel — that is how the panel lost its own background')
      .not.toMatch(/content-visibility:\s*hidden[\s\S]{0,80}\[class\$='_columns'\]/)
    expect(declarations, 'the target must be the dedicated grid attribute')
      .toMatch(/\[data-dsh-tb-columns\]\s*\{\s*content-visibility:\s*hidden;/)
  })

  it('the box is kept, so closing the panel does not shift the board', () => {
    // `display: none` would drop the grid's box and make the board jump on close.
    const rule = /\[data-dsh-tb-columns\] \{[^}]*\}/.exec(declarations)?.[0] ?? ''
    expect(rule, 'the rule not found').not.toBe('')
    expect(rule, 'display:none would collapse the grid and make the board jump back on close')
      .not.toMatch(/display:\s*none/)
  })
})
