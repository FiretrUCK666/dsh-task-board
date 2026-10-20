/**
 * Review-page pure logic (domain grouping): the transcript folding + usage
 * sum, the context-meter arithmetic, the slash-menu flip judgment and the
 * session to-do readout — the pure helpers the review page / session panel
 * render from, tested together as one contract file.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { foldTranscript, sumUsage, type TranscriptEvent } from '../src/client/board/review-transcript.ts'
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
 *  Reads enderedSource (board + design system) rather than the board sheet
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

  it('the rail clips horizontally; the FOLDS block owns the only scroll', () => {
    // Horizontal: nothing spills past and covers other UI. Vertical: the rail
    // does NOT scroll — a scrollport that contains the composer is exactly how
    // the send box gets pushed out of reach, and a `display: contents`
    // rail cannot scroll at all (a declared-but-dead scroller is a lie the
    // follow logic could walk into). The folds block owns the last resort.
    expect(ruleOf('reviewRail')).toContain('overflow: hidden')
    expect(ruleOf('reviewRail')).not.toMatch(/overflow-y:\s*auto/)
    expect(ruleOf('sessionRailFolds')).toMatch(/overflow-y:\s*auto/)
    expect(ruleOf('sessionRailFolds')).toMatch(/min-height:\s*0/)
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
    // The rail clips on both axes; the folds block is the only scroller
    // (check the rail layout contract — a scrolling rail could push the
    // composer out of reach again).
    expect(ruleOf('reviewRail')).toContain('overflow: hidden')
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
    // 滑到最新 binds ONLY the comments scroller (the 「跳转范围错误」 fix).
    expect(panelSource).toMatch(/onCommentsScroll/)
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

  it('the tail resolves the real scroller and listens in the capture phase', () => {
    // The stacked panel scrolls its BODY, not the inner region: following must
    // follow the resolved scroller, and scroll events (which do not bubble)
    // are seen through a window-level capture listener.
    expect(followSource).toMatch(/export function resolveScroller/)
    expect(followSource).toMatch(/addEventListener\('scroll', handler, true\)/)
    expect(followSource).toMatch(/export function useFollowScroll/)
  })

  it('the comment thread reuses the same hook instead of re-rolling it', () => {
    expect(panelSource).toMatch(/useFollowScroll\(/)
    // No hand-rolled scrollTop pinning left in the panel (one mechanism —
    // the only scrollTop writes are the follow/jump/anchor paths).
    const writes = panelSource.match(/scrollTop\s*=/g) ?? []
    expect(writes.length).toBe(0)
    // OPEN / NEW ASK = LATEST: opening the comments fold (manual tap or a
    // pending question force-opening it) and every new ask pin the box to the
    // newest comment; the old per-open opt-out (`initialToBottom`) is gone —
    // there is exactly one semantic, not a first-open/re-open fork.
    expect(panelSource).toMatch(/const openEdgeRef = useRef\(commentsOpen \|\| awaiting\)/)
    expect(panelSource).toMatch(/if \(awaiting \|\| opened\) jumpComments\(\)/)
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

describe('foldTranscript', () => {
  const base = { seq: 1, time: 1000 }

  /** A user/message event with the native flat shape. */
  function userMessage(id: string, text: string, sourceKind = 'user', extra: Record<string, unknown> = {}): TranscriptEvent {
    return {
      ...base,
      type: 'user/message',
      data: {
        id,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: sourceKind, ...extra },
      },
    }
  }

  it('folds user messages (flat shape) and assistant messages (wrapped message)', () => {
    const events: TranscriptEvent[] = [
      userMessage('m1', '你好'),
      {
        ...base,
        seq: 2,
        time: 2000,
        type: 'assistant/message',
        data: {
          turn: 1,
          step: 1,
          message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: '你好，我是 agent' }] },
        },
      },
    ]
    expect(foldTranscript(events)).toEqual([
      { kind: 'message', id: 'm1', role: 'user', text: '你好', at: 1000 },
      { kind: 'message', id: 'm2', role: 'assistant', text: '你好，我是 agent', at: 2000 },
    ])
  })

  it('keeps durable image refs (the host-promoted form) and image-only messages', () => {
    const events: TranscriptEvent[] = [
      {
        ...base,
        type: 'user/message',
        data: {
          id: 'm1',
          role: 'user',
          source: { kind: 'user' },
          content: [
            { type: 'text', text: '看这张图' },
            // The stored (post-admission) shape: a durable ref, not bytes.
            { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', name: 'a.png', bytes: 10, width: 2, height: 2 } },
            { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png' } }, // dup → dropped
            { type: 'image', attachment: { mediaType: 'image/png' } }, // no id → skipped
          ],
        },
      },
      {
        ...base,
        seq: 2,
        type: 'user/message',
        data: { id: 'm2', role: 'user', source: { kind: 'user' }, content: [{ type: 'image', attachment: { attachmentId: 'att-2', mediaType: 'image/jpeg' } }] },
      },
    ]
    const lines = foldTranscript(events)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ kind: 'message', text: '看这张图', images: [{ attachmentId: 'att-1', mediaType: 'image/png', name: 'a.png' }] })
    // An image-only message is NOT dropped (empty text, one image).
    expect(lines[1]).toMatchObject({ kind: 'message', text: '', images: [{ attachmentId: 'att-2' }] })
  })

  it('turns non-user injections into context rows, never user bubbles', () => {
    const events: TranscriptEvent[] = [
      // Runtime-context injection (V4 durable source: a kind + its form).
      userMessage('c1', 'Current runtime context…', 'time-context', { form: 'snapshot' }),
      // A notice-form injection carries a one-line summary.
      userMessage('c2', '…', 'cron', { form: 'notice', summary: 'cron: 每天 9 点任务已触发' }),
      // A real user message still becomes a bubble.
      userMessage('m1', '真正的问题', 'user'),
    ]
    expect(foldTranscript(events)).toEqual([
      { kind: 'context', id: 'c1', producer: 'time-context', summary: '', at: 1000 },
      { kind: 'context', id: 'c2', producer: 'cron', summary: 'cron: 每天 9 点任务已触发', at: 1000 },
      { kind: 'message', id: 'm1', role: 'user', text: '真正的问题', at: 1000 },
    ])
  })

  it('names each context row from the durable source kind (the official producer grammar)', () => {
    // The V4 source grammar. Three kinds point at the data they injected, so
    // the row names THAT (the official `contextProducer` label); every other
    // kind is its own label. Distinct values are deduped, in appearance order.
    const events: TranscriptEvent[] = [
      userMessage('c1', '<system-reminder>instructions…</system-reminder>', 'agent-instructions', {
        changes: [
          { scope: 'workspace', action: 'add', path: 'AGENTS.md' },
          { scope: 'workspace', action: 'add', path: 'AGENTS.md' },
          { scope: 'user', action: 'add', path: '~/.dsh/AGENTS.md' },
        ],
      }),
      // A baseline injection carries no changes: the kind is the label.
      userMessage('c2', '…', 'agent-instructions', { baseline: true, changes: [] }),
      userMessage('c3', '…', 'skill-invocation', { name: 'project-forge', form: 'instructions' }),
      userMessage('c4', '…', 'session-reference', {
        references: [{ sessionId: 's-1', label: '看板重构' }, { sessionId: 's-2', label: '看板重构' }],
      }),
      // The label never comes from a `plugin` member, and a source with no
      // usable kind is the generic context row.
      {
        ...base,
        seq: 5,
        type: 'user/message',
        data: { id: 'c5', role: 'user', content: [{ type: 'text', text: '…' }], source: { plugin: 'dsh-cron' } },
      },
    ]
    expect(foldTranscript(events)).toEqual([
      { kind: 'context', id: 'c1', producer: 'AGENTS.md, ~/.dsh/AGENTS.md', summary: '', at: 1000 },
      { kind: 'context', id: 'c2', producer: 'agent-instructions', summary: '', at: 1000 },
      { kind: 'context', id: 'c3', producer: 'project-forge', summary: '', at: 1000 },
      { kind: 'context', id: 'c4', producer: '看板重构', summary: '', at: 1000 },
      { kind: 'context', id: 'c5', producer: 'context', summary: '', at: 1000 },
    ])
  })

  it('joins multiple text blocks and skips empty messages and non-message events', () => {
    const events: TranscriptEvent[] = [
      {
        ...base,
        type: 'user/message',
        data: { id: 'm1', role: 'user', content: [{ type: 'text', text: '  a ' }, { type: 'text', text: ' b ' }], source: { kind: 'user' } },
      },
      // Empty content and non-message events are skipped.
      { ...base, seq: 2, type: 'user/message', data: { id: 'm2', role: 'user', content: [], source: { kind: 'user' } } },
      { ...base, seq: 3, type: 'turn/start', data: { turn: 1 } },
      { ...base, seq: 4, type: 'tool/call', data: { name: 'bash' } },
      { ...base, seq: 5, type: 'tool/result', data: { message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 't', content: [] }] } } },
    ]
    expect(foldTranscript(events)).toEqual([
      { kind: 'message', id: 'm1', role: 'user', text: 'a\nb', at: 1000 },
    ])
  })

  it('falls back to the event sequence for messages without an id', () => {
    const events: TranscriptEvent[] = [
      { ...base, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } } },
    ]
    const folded = foldTranscript(events)
    expect(folded[0].kind).toBe('message')
    if (folded[0].kind === 'message') expect(folded[0].id).toBe('1')
  })

  it('returns an empty list for an empty or all-skipped event list', () => {
    expect(foldTranscript([])).toEqual([])
    expect(foldTranscript([{ ...base, type: 'turn/end', data: { turn: 1 } }])).toEqual([])
  })
})

describe('transcript usage', () => {
  const base = { seq: 1, time: 1000 }

  it('carries the native usage payload on assistant messages', () => {
    const events: TranscriptEvent[] = [
      {
        ...base,
        type: 'assistant/message',
        data: {
          turn: 1,
          step: 1,
          message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
          usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, reasoningTokens: 3 },
        },
      },
    ]
    const folded = foldTranscript(events)
    expect(folded[0].kind).toBe('message')
    if (folded[0].kind === 'message') {
      expect(folded[0].usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, reasoningTokens: 3 })
    }
  })

  it('sums usage across assistant messages, skipping optional fields when absent', () => {
    const lines = [
      { kind: 'message' as const, id: 'a', role: 'user' as const, text: 'q', at: 0 },
      { kind: 'message' as const, id: 'b', role: 'assistant' as const, text: '1', at: 1, usage: { inputTokens: 10, outputTokens: 5 } },
      { kind: 'context' as const, id: 'c', producer: 'x', summary: '', at: 2 },
      { kind: 'message' as const, id: 'd', role: 'assistant' as const, text: '2', at: 3, usage: { inputTokens: 4, outputTokens: 1, cacheWriteTokens: 7, reasoningTokens: 2 } },
    ]
    expect(sumUsage(lines)).toEqual({
      inputTokens: 14,
      outputTokens: 6,
      cacheWriteTokens: 7,
      reasoningTokens: 2,
    })
    expect(sumUsage([lines[0]])).toBeUndefined()
  })

  it('the meter prefers whole-log projection totals over the paged-window sum', () => {
    // P7: `tokenUsage` is durable whole-log; the 30-message `sumUsage` is
    // only the fallback when the meter package is absent. The stats line
    // comes from `sessionStats` (turns/steps/times), never recomputed.
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panel = readFileSync(panelPath, 'utf8')
    expect(panel).toMatch(/projections\?\.tokenUsage/)
    expect(panel).toMatch(/review\.usageTotal/)
    expect(panel).toMatch(/review\.usageCacheWrite/)
    expect(panel).toMatch(/projections\?\.sessionStats/)
    expect(panel).toMatch(/review\.statsTurns/)
    // Every picked figure renders: TTFT average, decode rate, hit rate.
    expect(panel).toMatch(/review\.statsTtft/)
    expect(panel).toMatch(/review\.usageTps/)
    expect(panel).toMatch(/review\.usageHitRate/)
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

