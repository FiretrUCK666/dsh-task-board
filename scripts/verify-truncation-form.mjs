#!/usr/bin/env node
/**
 * THE TRUNCATION FORM HAS ONE HOME.
 *
 * ── The disease ──────────────────────────────────────────────────────────────
 *
 * "A title shows in how many lines, how it is cut, and how the reader reads it
 * back" has no home in this project. It was copied thirty times. Eight of those
 * copies carry the title semantics itself, spread over three sheets, and they
 * answer four different ways (wrap / one line with an ellipsis / two clamped
 * lines / a hard cut with no ellipsis).
 *
 * The shared layer owns exactly ONE home for it:
 *
 *     src/client/design/components.module.css  ->  .truncate
 *
 * Everything else is a re-spelling. And a re-spelling costs more than the few
 * lines it saves: **changing one place does not report an error.** The reader
 * who wants "both places truncate the same way" changes the shared one; the
 * copy in the page sheet stays as it was, and nothing on screen says why.
 *
 * ── Why the existing gates did not catch it ──────────────────────────────────
 *
 * `verify-design-docs.mjs` (check 5d, `duplicateBodies`) judges rule BODIES that
 * are byte-identical across two sheets. Every copy of this form carries one
 * extra declaration (a colour, a font size), so **not one of them matched**:
 *
 *     shared forms: 8 sheet(s) checked, 0 rule body(ies) declared in more than one
 *
 * Copying a thing, therefore, turns no gate red. That is the exact shape of the
 * disease this gate closes.
 *
 * ── What this gate reads (STRUCTURE, never wording) ──────────────────────────
 *
 * A rule in a PAGE sheet that declares BOTH
 *
 *   - a no-wrap declaration  (`white-space: nowrap`), AND
 *   - an ellipsis declaration (`text-overflow: ellipsis`)
 *
 * is spelling out the truncation form itself. Comments are stripped before the
 * match, so the word "ellipsis" inside a comment is not a use of it.
 *
 * The second member of the family is the TWO-LINE CLAMP: a rule that declares
 * `-webkit-line-clamp` together with `overflow: hidden` clips text just as
 * surely as an ellipsis does. It is judged too, and it carries a reasoned
 * exemption (see below) because the shared layer has no home for it yet.
 *
 * ── Where the home is ────────────────────────────────────────────────────────
 *
 * The shared layer is `src/client/design/`. Everything else under
 * `src/client/` is a page sheet: the board's, the list's, the overview's, the
 * gallery's, the chat's. **The set is derived from the directory, never from a
 * list of names** — a list is only right on the day it is written, and a new
 * page would arrive un-checked. The shared layer is where the form lives, so
 * the shared layer is exempt; a page sheet is not.
 *
 * ── Exemptions are keyed by SHAPE ────────────────────────────────────────────
 *
 * An exemption is keyed by a fragment of the NORMALISED declaration body
 * (declarations trimmed, whitespace collapsed, order ignored — the same
 * normalisation `verify-design-docs.mjs` uses, so the two gates speak one
 * language). That makes the exemption a RATCHET:
 *
 *   - change the shape of that rule and the fragment no longer appears in it,
 *     the exemption dies, and the gate reports it again;
 *   - an exemption also dies the moment the shared layer grows a home for that
 *     shape (the `home` fragment appears in a shared-layer rule) — so a
 *     "there is no home yet" exemption cannot outlive the home it is waiting for.
 *
 * Every exemption must carry a STRUCTURAL reason, never a preference.
 *
 * ── How to fix a reported site ───────────────────────────────────────────────
 *
 * Delete the form from the page rule and apply the shared class to the element
 * (`className={`${css.yourThing} ${components.truncate}`}`). The shared class
 * states the one obligation every caller has to honour: **the element must be
 * allowed to shrink** (`min-width: 0`), because an ellipsis that never engages
 * is not a truncation, it is a spill.
 *
 * Usage: `node scripts/verify-truncation-form.mjs [root]`
 * Probes: `--probe-copy` (a page sheet that copies the form must be reported)
 *         `--probe-shared` (the shared layer's own copy must be let through)
 *         `--probe-exempt` (an exempted shape is let through)
 *         `--probe-ratchet` (the exemption dies when the shape changes)
 */

import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rulesOf } from './css-core.mjs'
import { clientSheetFiles } from './sheet-files.mjs'
import { probeOf } from './probe-args.mjs'

/**
 * The shared layer: the place the shared forms live. A rule there is the home,
 * not a copy.
 * @type {string}
 */
export const SHARED_LAYER = 'src/client/design/'

/**
 * THE HOME ITSELF — the one rule in the shared layer that spells the form out
 * *as the answer* rather than as a copy of it.
 *
 * **Why this is a name and not "any rule in the shared layer".** The exemption
 * used to cover the whole sheet, on the reasoning that the home lives there. It
 * does — but a sheet is not a rule: measured, five more rules inside the very
 * same sheet spelled out the same three declarations (`.chipBody`,
 * `.inlineSummary`, a section head, `.workbenchStatus`, `.workbenchNoticeText`),
 * and every one of them was invisible to this gate, because the gate never
 * looked. The question the gate asks is 「这条形态有几个家」 — not 「它住在哪张
 * 表里」. So the exemption belongs to the rule, not to the sheet.
 *
 * `--probe-shared` keeps this honest: it feeds a shared sheet whose home rule is
 * present and asserts the gate stays quiet about *that* rule.
 * @type {readonly string[]}
 */
export const SHARED_HOME_SELECTORS = ['.truncate']

/**
 * Shapes a page sheet may spell out on its own, with the reason.
 *
 * **The key is a fragment of the normalised declaration body.** That is what
 * makes this a ratchet rather than a list of known-bad lines: change the shape
 * and the exemption no longer applies, so the gate reports the site again.
 *
 * `home` (optional) names a fragment that must NOT appear in any shared-layer
 * rule: the exemption is an admission that "the shared layer has no home for
 * this shape yet", and the day it grows one, this entry must stop applying —
 * without that, a debt entry would outlive the thing it is waiting for.
 *
 * @type {readonly { match: string, home?: string, why: string }[]}
 */
export const PER_SHEET_EXEMPTIONS = [
  /* **空表，而且这本身是一条结论。** 这里曾经有一条：「两行夹这一族还没有家」——它描述的
   * 是共享层只有一行省略号、而夹两行是另一种裁法的那个时期。后来那一族被收进共享层做成了
   * `.titleClamp2`，再后来「卡片不许有截断」落地、它失去所有消费者、连同那个家一起被删掉。
   *
   * 也就是说这条豁免**等到了它等的东西，然后那个东西整个消失了**。硬性规范 18 管的就是
   * 这一步：删一个形态要一起清干净——留着这条记录，它就是在描述一族不存在的形态，
   * 而「一个看起来很权威的假线索」比缺一条注释贵得多。
   *
   * 空表不是「没有规矩」：`--probe-exempt` 会种一条带理由的豁免并要求门禁放行，所以
   * 「豁免机制还活着」这件事仍然被证明。 */
]

/**
 * Normalise a declaration body: comments gone (the caller strips them), each
 * declaration trimmed, whitespace collapsed, order ignored.
 *
 * The SAME normalisation `verify-design-docs.mjs` uses for its body comparison,
 * so the two gates describe a shape in one language.
 *
 * @param {string} body - a rule body.
 * @returns {string}
 */
export function normaliseBody(body) {
  return body
    .split(';')
    .map((one) => one.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .sort()
    .join(';')
}

/**
 * The declarations of one rule body, as `{ property, value }` pairs.
 *
 * Segments holding a brace are skipped: that is a nested rule, not a
 * declaration, and splitting it on `;` would invent declarations that are not
 * there.
 *
 * @param {string} body - a rule body.
 * @returns {{ property: string, value: string }[]}
 */
export function declarationsIn(body) {
  const out = []
  for (const part of body.split(';')) {
    if (part.includes('{') || part.includes('}')) continue
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const property = part.slice(0, colon).trim()
    const value = part.slice(colon + 1).trim()
    if (property === '' || value === '') continue
    out.push({ property, value })
  }
  return out
}

/**
 * Is this sheet a PAGE sheet (as opposed to the shared layer)?
 *
 * @param {string} rel - repo-relative path of the sheet.
 * @returns {boolean}
 */
export function isPageSheet(rel) {
  return !rel.startsWith(SHARED_LAYER)
}

/**
 * Does a rule spell out the truncation form?
 *
 * Two members, both read as structure:
 *
 *   - the ELLIPSIS member: `white-space: nowrap` together with
 *     `text-overflow: ellipsis` — the text is not allowed to wrap and the cut
 *     is shown as an ellipsis;
 *   - the CLAMP member: `-webkit-line-clamp` (or `line-clamp`) together with
 *     `overflow: hidden` — the text is clipped at a line count.
 *
 * @param {string} body - a rule body.
 * @returns {{ kind: 'ellipsis' | 'clamp', first: string, second: string } | null}
 */
export function truncationFormIn(body) {
  const decls = declarationsIn(body)
  const nowrap = decls.find((one) => one.property === 'white-space' && one.value === 'nowrap')
  const ellipsis = decls.find((one) => one.property === 'text-overflow' && one.value === 'ellipsis')
  if (nowrap && ellipsis) {
    return {
      kind: 'ellipsis',
      first: `white-space: ${nowrap.value}`,
      second: `text-overflow: ${ellipsis.value}`,
    }
  }
  const clamp = decls.find((one) => one.property === '-webkit-line-clamp' || one.property === 'line-clamp')
  const hidden = decls.find((one) => one.property === 'overflow' && one.value === 'hidden')
  if (clamp && hidden) {
    return {
      kind: 'clamp',
      first: `${clamp.property}: ${clamp.value}`,
      second: `overflow: ${hidden.value}`,
    }
  }
  return null
}

/**
 * Every page sheet that spells out the truncation form.
 *
 * @param {{ rel: string, css: string }[]} sheets - the client sheets.
 * @param {readonly { match: string, home?: string, why: string }[]} [exemptions]
 *   - shapes that are allowed to be spelled out, with their reasons.
 * @returns {{ file: string, line: number, selector: string, at: string,
 *   kind: string, first: string, second: string, body: string,
 *   exempt: boolean, why: string | null }[]}
 */
export function truncationCopiesIn(sheets, exemptions = PER_SHEET_EXEMPTIONS) {
  const sharedBodies = sheets
    .filter((sheet) => !isPageSheet(sheet.rel))
    .flatMap((sheet) => rulesOf(sheet.css).map((rule) => normaliseBody(rule.body)))
  const out = []
  for (const sheet of sheets) {
    /* **豁免区不等于没有规矩。** 原先这一句是 `if (!isPageSheet(sheet.rel)) continue`——整个
     * 共享层被跳过，理由是「那个家本来就住那儿」。可豁免只该给**那个家本身**：实测下来共享层
     * 内部还有 5 处自己抄了同一副三件套（`.chipBody` / `.inlineSummary` / 一个分节标题 /
     * 状态栏 / 通知文字），而它们从头到尾没人管。判据要问的是「这条形态有几个家」，不是
     * 「它住在哪张表里」。所以现在只放行**声明它的那几条**，同表里其余的拷贝照报。 */
    const page = isPageSheet(sheet.rel)
    for (const rule of rulesOf(sheet.css)) {
      if (!page && SHARED_HOME_SELECTORS.includes(rule.selector.trim())) continue
      const form = truncationFormIn(rule.body)
      if (form === null) continue
      const body = normaliseBody(rule.body)
      /* The exemption dies the moment the shared layer grows a home for that
       * shape: an admission that waits for a home must not outlive it. */
      const alive = exemptions.filter((one) => {
        if (!body.includes(one.match)) return false
        if (one.home === undefined) return true
        return !sharedBodies.some((shared) => shared.includes(one.home))
      })
      const exemption = alive[0]
      out.push({
        file: sheet.rel,
        /* The line is computed from the rule's offset, not from the parser's
         * segment-relative line: inside an at-rule the latter points at the
         * wrong line, and a report that names the wrong line is a report nobody
         * can act on. */
        line: sheet.css.slice(0, rule.offset).split('\n').length,
        selector: rule.selector,
        at: rule.at,
        kind: form.kind,
        first: form.first,
        second: form.second,
        body,
        exempt: exemption !== undefined,
        why: exemption?.why ?? null,
      })
    }
  }
  return out
}

/**
 * Read the client sheets of a repository.
 *
 * @param {string} root - repo root.
 * @returns {{ rel: string, css: string }[]}
 */
export function sheetsOf(root) {
  return clientSheetFiles(root).map((sheet) => ({ rel: sheet.rel, css: sheet.css }))
}

/**
 * The probe fixtures: a fake repository per case, planted under `tests/`.
 *
 * Planting them in `tests/` is the rule (hard rule 16): proving a gate bites
 * must not be done by editing a real file and editing it back — that proves
 * the edit landed, not that the gate is alive.
 *
 * @param {string} root - repo root.
 * @param {string} name - the fixture's directory name.
 * @returns {{ rel: string, css: string }[]}
 */
function fixtureSheets(root, name) {
  const dir = join(root, 'tests', 'fixtures', 'truncation-form', name)
  /* `clientSheetFiles` walks `<root>/src/client`, and the fixture mirrors that
   * shape — so the shared-layer case is a real path, not a label. */
  return clientSheetFiles(dir).map((sheet) => ({ rel: sheet.rel, css: sheet.css }))
}

/**
 * THE PROBE'S OWN EXEMPTION — used only by the two self-tests below.
 *
 * The production table is empty, and empty is the correct state: the one entry it
 * ever held waited for a home, the home was built, and then the whole shape was
 * deleted (hard rule 18). A self-test that read the production table would report
 * "the exemption mechanism is broken" the moment the debt was paid — which is the
 * opposite of what it should say. So the probes carry their own entry and prove
 * the BRANCH works, regardless of what production happens to need today.
 * @type {readonly { match: string, why: string }[]}
 */
const PROBE_EXEMPTIONS = [
  {
    match: '-webkit-box-orient: vertical;-webkit-line-clamp: 2',
    why: '这一条只活在自测里：证明「写清理由的豁免会被读到并放行」。',
  },
]

function main() {
  const probe = probeOf(['--probe-copy', '--probe-shared', '--probe-exempt', '--probe-ratchet'])
  const root = process.argv[2] ?? '.'

  if (probe !== undefined) {
    if (probe === '--probe-copy') {
      const found = truncationCopiesIn(fixtureSheets(root, 'copy'))
      if (found.length === 0) {
        console.error('FAIL 自测：页面表自己抄了一份裁剪形态，必须被报出来，但一条都没有。')
        process.exit(1)
      }
      console.log(`OK 自测：页面表抄的那一份被报出来 ${found.length} 条（门禁是活的）。`)
      return
    }
    if (probe === '--probe-shared') {
      const found = truncationCopiesIn(fixtureSheets(root, 'shared'))
      if (found.length !== 0) {
        console.error('FAIL 自测：共享层自己那一份是那个家，必须放行，却报了：')
        for (const one of found) console.error(`  ${one.file}:${one.line}  ${one.selector}`)
        process.exit(1)
      }
      console.log('OK 自测：共享层自己那一份放行（不误伤那个家）。')
      return
    }
    if (probe === '--probe-exempt') {
      const found = truncationCopiesIn(fixtureSheets(root, 'exempt'), PROBE_EXEMPTIONS)
      const exempt = found.filter((one) => one.exempt)
      if (exempt.length === 0) {
        console.error('FAIL 自测：豁免表里写明理由的那一种形状必须放行，却一条都没放行。')
        process.exit(1)
      }
      console.log(`OK 自测：豁免的形状放行 ${exempt.length} 条（豁免是有理由的，不是白名单）。`)
      return
    }
    /* The ratchet: the exemption is keyed by the SHAPE, so changing the shape
     * makes it die and the gate reports the site again. */
    const before = truncationCopiesIn(fixtureSheets(root, 'ratchet-before'), PROBE_EXEMPTIONS)
    const after = truncationCopiesIn(fixtureSheets(root, 'ratchet-after'), PROBE_EXEMPTIONS)
    const beforeExempt = before.filter((one) => one.exempt).length
    const afterExempt = after.filter((one) => one.exempt).length
    if (beforeExempt === 0) {
      console.error('FAIL 自测：棘轮的前一半——原样的那一处应当豁免。')
      process.exit(1)
    }
    if (afterExempt !== 0) {
      console.error('FAIL 自测：形状一变，豁免必须自动失效、门禁重新报——它还活着。')
      process.exit(1)
    }
    if (after.length === 0) {
      console.error('FAIL 自测：形状一变之后门禁必须重新报出来，却一条都没有。')
      process.exit(1)
    }
    console.log('OK 自测：形状一变，豁免自动失效，门禁重新报（棘轮是真的）。')
    return
  }

  const sheets = sheetsOf(root)
  const found = truncationCopiesIn(sheets)
  const live = found.filter((one) => !one.exempt)
  const exempt = found.filter((one) => one.exempt)
  if (live.length === 0) {
    console.log(
      `verify-truncation-form OK: ${String(sheets.length)} 张表，${String(found.length)} 处裁剪形态` +
        `（豁免 ${String(exempt.length)} 条）——页面表里没有自己抄的裁剪形态。`,
    )
    return
  }
  console.error(`FAIL ${String(live.length)} 处页面表自己抄了一份裁剪形态——那个家已经有一份了：`)
  for (const one of live) {
    console.error(`  ${one.file}:${one.line}  ${one.selector}${one.at === '' ? '' : `  (在 ${one.at} 里)`}`)
    console.error(`    凑成裁剪形态的两条声明：${one.first}  +  ${one.second}`)
  }
  console.error('')
  console.error('  抄一份的代价不是那几行，是**改一处不报错**：')
  console.error('  读者要「两处裁法一致」时，其中一处不会跟着变，而屏上不会有人说一句话。')
  console.error('  改法：删掉页面表里那几条声明，改挂共享形态（design/components.module.css 的 .truncate），')
  console.error('  并确认那个元素**允许被压窄**（min-width: 0）——不缩的省略号不是裁剪，是溢出。')
  process.exit(1)
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  main()
}
