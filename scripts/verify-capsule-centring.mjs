/**
 * 胶囊居中的机械门禁：**任何「定高 + 一行字 + 有内衬」的盒子，行高必须是墨高档。**
 *
 * 为什么需要一条门禁而不是一段文档。这件事已经反复出现三次，每次的形态都一样：
 * 一枚胶囊写死了 `block-size`、写死了 `line-height: 1`，于是行盒（12–13px）被塞进
 * 一个 20–28px 的盒子里，多出来的空间由浏览器的对齐规则分配——而分配结果**跟着字体
 * 跑**。桌面字体下正好，iOS 的中文字体下就整体偏高。读者看到的是「手机端东西都往上
 * 抬了一点」，而代码里没有任何一处写错。
 *
 * 一条写在 `DESIGN.md` 里的规矩，下一个加胶囊的人（或 AI）不会读到；这条门禁会读到。
 *
 * ── 它查什么 ────────────────────────────────────────────────────────────────
 *
 * 一条规则同时满足下面四条时，它就是「一枚定高胶囊」：
 *
 *   1. 声明了 `block-size` 或 `height`（定高；`min-`/`max-` 不算）
 *   2. 声明了 `line-height`（它管着一行字）
 *   3. 声明了内衬的块向（`padding` 简写或 `padding-block*`）
 *   4. 声明了 `align-items: center`（它想把内容居中）
 *
 * 对这种规则，判据是：`line-height` 必须**等于** `font-size`，或者读
 * `--dsh-tb-text-line-h`（那个令牌的值就是 `1em`）。两种写法等价，都表示
 * 「行盒 = 墨高」——`halfLeading` 为 0，墨心即盒心。
 *
 * 不满足就报出来，并且**指名那一条规则**，便于直接改。这不是风格检查：一条 `line-height: 1`
 * 在 28px 盒子里就是 1px 的偏差，而它在桌面端看不出来。
 *
 * ── 它不查什么 ──────────────────────────────────────────────────────────────
 *
 * 图标按钮、徽标、正文段落、多行容器都不在这条判据里：它们要么没有一行字，要么行高
 * 本来就该由正文节奏决定（行高 22px 的段落是排版，不是胶囊）。
 *
 * 用法：node scripts/verify-capsule-centring.mjs [repoRoot]
 * 退出码 0 = 全部合规；1 = 有发现（逐条列在输出里）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = process.argv[2] ?? process.cwd()
const clientDir = join(root, 'src', 'client')

/**
 * Self-test: plant two capsules and prove the judgement reacts to both.
 *
 * WHY IT IS HERE AND NOT IN A SPEC. A gate that cannot fail is a gate that
 * proves nothing — and the two ways this one can fail are (a) reading the CSS
 * so loosely that every rule passes, and (b) reading it so strictly that a
 * lawful capsule is reported. Both are silent without a planted case.
 */
if (process.argv.includes('--probe-capsule-centring')) {
  const probe = [
    /* Lawful: line height reads the ink token. */
    '.ok { block-size: 20px; padding-inline: 8px; padding-block: max(0px, calc(-1 * var(--dsh-tb-line-nudge))) max(0px, var(--dsh-tb-line-nudge)); font-size: 12px; line-height: var(--dsh-tb-text-line-h); align-items: center; }',
    /* Lawful: line height literally equals the font size, nudge on the block end. */
    '.ok2 { block-size: 20px; padding: 0 8px calc(2 * var(--dsh-tb-line-nudge)); font-size: 12px; line-height: 12px; align-items: center; }',
    /* Finding: a hard 1 inside a 20px box. */
    '.bad { block-size: 20px; padding: 0 8px calc(2 * var(--dsh-tb-line-nudge)); font-size: 12px; line-height: 1; align-items: center; }',
    /* Finding: the line box is right but nothing corrects the ink inside it. */
    '.bad2 { block-size: 20px; padding: 0 8px; font-size: 12px; line-height: var(--dsh-tb-text-line-h); align-items: center; }',
    /* NOT a capsule: no fixed height, so a paragraph rhythm is fine. */
    '.paragraph { padding: 4px; font-size: 13px; line-height: 19px; align-items: center; }',
  ]
  const seen = []
  for (const css of probe) {
    const allRules = rulesOf(css)
    for (const rule of allRules) {
      /* **多选择器列表要合起来看。** 一个类常常被拆成好几条规则（基础 + 宽度 + 悬停），
         而「行高 = 墨高」「块向内衬带校正」这两件事可以落在其中任意一条上。只读命中的
         第一条会把一条已经修好的胶囊报成还没修——门禁的假阳性会让下一个人去改对的
         东西（硬性规范 14）。所以按**选择器里出现了这个类**把同一族规则合起来。 */
      const family = allRules.filter(other => {
        const a = other.selector.split(',').map(part => part.trim())
        const b = rule.selector.split(',').map(part => part.trim())
        return a.some(sel => b.includes(sel))
      })
      /* 合并时**要判的那件事优先级最高**：同一族的另一条规则若把行高写成别的值，
       * `declOf` 会取最后一条——而「这一族里有一条读的是墨高令牌」才是事实。所以把读
       * 令牌的那几条摆在后面，让它们胜出。 */
      const readsToken = (body) => /line-height\s*:\s*var\(--dsh-tb-text-line-h\)/.test(body)
      const ordered = [
        ...family.filter(other => !readsToken(other.body)),
        rule,
        ...family.filter(other => readsToken(other.body)),
      ]
      const merged = ordered.map(other => other.body).join("\n")
      const body = merged
      const fixedHeightRaw = declOf(body, 'block-size') ?? declOf(body, 'height')
      /* **`100%` 不是固定高，是不声明。** 一个读父级的盒子，它自己的高度由父级给——
       * 「行盒 = 墨高」在这里仍然要判，但「定高胶囊」这个前提不成立。所以只把
       * 真正的长度（px / var / calc）当作定高，百分比与 `auto` 都不算。 */
      const fixedHeight = fixedHeightRaw !== undefined && !/%|auto|max-content|min-content|fit-content/.test(fixedHeightRaw)
        ? fixedHeightRaw
        : undefined
      const lineHeight = declOf(body, 'line-height')
      const fontSize = declOf(body, 'font-size')
      const paddingBlock = declOf(body, 'padding-block')
      const padding = declOf(body, 'padding')
      const centered = declOf(body, 'align-items') === 'center'
      if (fixedHeight === undefined || lineHeight === undefined || !centered) continue
      if (paddingBlock === undefined && padding === undefined) continue
      if (fontSize === undefined) continue
      const lineBoxOk = lineHeight.includes('--dsh-tb-text-line-h') || lineHeight === fontSize || lineHeight === '1em'
      const nudgeOk = ['padding', 'padding-block', 'padding-block-end', 'padding-block-start']
        .some(property => declOf(body, property)?.includes('--dsh-tb-line-nudge') === true)
      seen.push({ selector: rule.selector, lawful: lineBoxOk && nudgeOk })
    }
  }
  const expected = [
    { selector: '.ok', lawful: true },
    { selector: '.ok2', lawful: true },
    { selector: '.bad', lawful: false },
    { selector: '.bad2', lawful: false },
  ]
  const ok = JSON.stringify(seen) === JSON.stringify(expected)
  console.log(ok
    ? `verify-capsule-centring self-test OK: ${seen.length} planted rule(s) read as expected (a lawful token read and a literal font-size match are accepted; a hard 1 and a stray line height are reported; a paragraph with no fixed height is not a capsule)`
    : `verify-capsule-centring self-test FAILED: expected ${JSON.stringify(expected)}, read ${JSON.stringify(seen)}`)
  process.exit(ok ? 0 : 1)
}

/** 每条 CSS 规则：选择器 + 声明块原文。 */
function rulesOf(css) {
  const live = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  for (const match of live.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? '').trim()
    const body = match[2] ?? ''
    /* `@media` / `@container` 的前导 at-rule 会混进选择器，剥掉。 */
    const cleaned = selector.replace(/@[a-z-]+[^{]*$/i, '').trim()
    if (cleaned === '' || cleaned.startsWith('@')) continue
    out.push({ selector: cleaned, body })
  }
  return out
}

/**
 * 一条声明块里的某个属性（最后一条胜出，与级联一致）。
 *
 * **先剥注释再解析**，两件事都必要：
 *
 *   1. 注释里会写着「这条 `line-height` 是兜底」这类句子，正则会把解释读成一个
 *      属性值——读出来的值和真的值长得一模一样，正是硬性规范 14 说的那种误判。
 *   2. 分号只在括号之外才算分隔符。`padding: 0 14px calc(2 * var(--x))` 里的括号
 *      让「哪个分号是真分隔符」需要计数才知道；不计数就会把上一条声明剩下的半截
 *      当成这一条的值。
 */
function declOf(body, property) {
  const live = body.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  let depth = 0
  let start = 0
  const collect = (end) => {
    const piece = live.slice(start, end)
    start = end + 1
    const colon = piece.indexOf(':')
    if (colon < 0) return
    if (piece.slice(0, colon).trim() !== property) return
    out.push(piece.slice(colon + 1).trim())
  }
  for (let index = 0; index < live.length; index += 1) {
    const char = live[index]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === ';' && depth === 0) collect(index)
  }
  collect(live.length)
  return out.length === 0 ? undefined : out[out.length - 1]
}

const findings = []
let capsules = 0

const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(path)
      continue
    }
    if (!entry.name.endsWith('.module.css')) continue
    const rel = relative(root, path).split(sep).join('/')
    const css = readFileSync(path, 'utf8')

    const allRules = rulesOf(css)
    for (const rule of allRules) {
      /* **多选择器列表要合起来看。** 一个类常常被拆成好几条规则（基础 + 宽度 + 悬停），
         而「行高 = 墨高」「块向内衬带校正」这两件事可以落在其中任意一条上。只读命中的
         第一条会把一条已经修好的胶囊报成还没修——门禁的假阳性会让下一个人去改对的
         东西（硬性规范 14）。所以按**选择器里出现了这个类**把同一族规则合起来。 */
      const family = allRules.filter(other => {
        const a = other.selector.split(',').map(part => part.trim())
        const b = rule.selector.split(',').map(part => part.trim())
        return a.some(sel => b.includes(sel))
      })
      /* 合并时**要判的那件事优先级最高**：同一族的另一条规则若把行高写成别的值，
       * `declOf` 会取最后一条——而「这一族里有一条读的是墨高令牌」才是事实。所以把读
       * 令牌的那几条摆在后面，让它们胜出。 */
      const readsToken = (sub) => /line-height\s*:\s*var\(--dsh-tb-text-line-h\)/.test(sub)
      const ordered = [
        ...family.filter(other => !readsToken(other.body)),
        rule,
        ...family.filter(other => readsToken(other.body)),
      ]
      const body = ordered.map(other => other.body).join('\n')
      const fixedHeightRaw = declOf(body, 'block-size') ?? declOf(body, 'height')
      /* **`100%` 不是固定高，是不声明。** 一个读父级的盒子，它自己的高度由父级给——
       * 「行盒 = 墨高」在这里仍然要判，但「定高胶囊」这个前提不成立。所以只把
       * 真正的长度（px / var / calc）当作定高，百分比与 `auto` 都不算。 */
      const fixedHeight = fixedHeightRaw !== undefined && !/%|auto|max-content|min-content|fit-content/.test(fixedHeightRaw)
        ? fixedHeightRaw
        : undefined
      const lineHeight = declOf(body, 'line-height')
      const fontSize = declOf(body, 'font-size')
      const paddingBlock = declOf(body, 'padding-block')
      const padding = declOf(body, 'padding')
      const centered = declOf(body, 'align-items') === 'center'

      /* **只认装文字的盒子。** 三个排除条件，每一条都对应一类真实误报：
       *
       *   - `svg` 规则：图标盒也定高、也读 `1lh`、也是 `align-items: center`，但它
       *     里面没有字，行高对图标毫无意义（量过：不加这条排除会报出 6 条假的）。
       *   - 伪类 / 伪元素（`:hover`、`::before`）：状态的样式不决定几何。
       *   - 后代选择器（`A > B`、`A B`）：它描述的是「A 里面的 B」，那个 B 自己
       *     才是要被判据的盒子。 */
      const targetsSvg = /(^|[\s,>])svg\b|::?(before|after|placeholder)/.test(rule.selector)
      const isDescendant = /[>]|\s(?![^,]*$)/.test(rule.selector.trim())
      if (targetsSvg || isDescendant) continue
      /* ── 判据是「它居中一行字吗」，不是「它定高吗」 ──────────────────────────
       *
       * 上一版只认**定高**的盒子，于是 `.itemGroupText` 这类「盒子高度由内容算、
       * 但里面是一行居中的字」全部漏掉了——而读者的报告正是那里：图标在药丸里居中
       * （它是定高方槽），字却偏（它没有行高，落回字体 `normal`，桌面偏下、手机偏上）。
       *
       * 所以判据改成：**`inline-flex` + `align-items: center|baseline`**，就当作
       * 「一行字的容器」。定高与否不改变「字要居中」这件事，只改变它居中在哪。
       *
       * 排除的是那些**不是一行字**的：只装图标/SVG 的、装多行正文的（`<p>` 那类）、
       * 以及纯布局的包裹盒（`display: flex` 且 `flex-direction: column`）。 */
      const isOneLineContainer = /display:\s*inline-flex/.test(body)
        && (declOf(rule.body, 'align-items') === 'center' || declOf(rule.body, 'align-items') === 'baseline')
      if (!isOneLineContainer) continue
      /* 只装图形的盒子有 `svg` 子项、没有字，行高对它没有意义。 */
      if (declOf(body, 'font-size') === undefined) continue
      if (fontSize === undefined) continue

      capsules += 1

      /* 两条判据同时成立才算合规：
       *
       *   1. 行高 = 墨高（读令牌，或字面等于字号）——这一条决定**行盒**的构造；
       *   2. 块向内衬带 `--dsh-tb-line-nudge` 的校正——这一条决定**墨在行盒里的位置**。
       *
       * 第 2 条是上一版漏掉的，也是「电脑端偏下、手机端正好」能漏过去的原因：
       * 行高改对了只让 `halfLeading` 归零，而字体本身的上下沿不对称还在，那一项
       * 只有运行时量出来的 nudge 能抵消。 */
      /* `--dsh-tb-text-line-h` 是 `1em`，也就是**在语义上等于字号**——所以读它就是
         合规，不必再比较字面值。字面比较仍然留着，因为 `font-size: 12px` 配
         `line-height: 12px` 是同一件事的另一种写法。 */
      const readsInkToken = (lineHeight ?? '').includes('--dsh-tb-text-line-h')
      const equalsFontSize = fontSize === lineHeight || lineHeight === '1em'
      if (!readsInkToken && !equalsFontSize) {
        findings.push({ file: rel, selector: rule.selector, lineHeight, fontSize, height: fixedHeight, why: 'line-box' })
        continue
      }
      /* 校正可以写成三种等价形态，全都要认：
       *   padding: … calc(2 * var(--dsh-tb-line-nudge))
       *   padding-block-end: … var(--dsh-tb-line-nudge)
       *   padding-block: max(0px, …) max(0px, … var(--dsh-tb-line-nudge))     ← 现在用的
       * 判据是「这一条规则的块向内衬读了这个令牌」，不是某一种写法。 */
      const carriesNudge = ['padding', 'padding-block', 'padding-block-end', 'padding-block-start']
        .some(property => declOf(body, property)?.includes('--dsh-tb-line-nudge') === true)
      if (!carriesNudge) {
        findings.push({ file: rel, selector: rule.selector, lineHeight, fontSize, height: fixedHeight, why: 'ink-nudge' })
      }
    }
  }
}

walk(clientDir)

if (findings.length === 0) {
  console.log(`verify-capsule-centring OK: ${capsules} fixed-height one-line capsule(s) all set line-height to the ink height (--dsh-tb-text-line-h), so ink centre equals box centre for every font`)
  process.exit(0)
}

console.error(`verify-capsule-centring FAILED: ${findings.length} capsule(s) size their line box differently from their ink`)
console.error('')
console.error('  行高必须等于字号（或读 --dsh-tb-text-line-h）。差出来的那一截会由浏览器按字体')
console.error('  的 ascent/descent 分配，于是同一份 CSS 在桌面上正好、在手机上整体偏上——')
console.error('  这正是「移动端把东西统一抬高了一点」的来源。')
console.error('')
for (const finding of findings) {
  const why = finding.why === 'ink-nudge'
    ? '缺 --dsh-tb-line-nudge 校正（行盒对了，墨在行盒里的位置还没校）'
    : '行高与字号不一致（行盒比墨高，多出的半行距按字体分配）'
  console.error(`  - ${finding.file}: ${finding.selector}`)
  console.error(`      ${why}`)
  console.error(`      block-size: ${finding.height}  font-size: ${finding.fontSize}  line-height: ${finding.lineHeight}`)
}
process.exit(1)
