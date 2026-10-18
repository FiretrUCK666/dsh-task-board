/**
 * The design-system gallery: one page that shows what the system contains.
 *
 * WHAT IT IS FOR. Two questions, both of which a component library otherwise
 * answers only by reading its own source:
 *
 *   1. 「这套东西里有什么」 — every variant, every kind, every glyph, every
 *      surface step and every design variable, on one screen.
 *   2. 「面板上用的就是这一个吗」 — because every specimen below IS the
 *      component the panels render, from the same module, with the same
 *      stylesheet. A gallery that re-implemented its specimens would be a
 *      second version of the thing it displays, and it would be the one that
 *      looked right the day the two drifted apart.
 *
 * IT RENDERS NO HOST DATA. No board, no checklist, no session: it is pure
 * front-end, which is what lets it be the page a designer opens while the rest
 * of the plugin is mid-refactor.
 *
 * EVERY LIST ON THIS PAGE IS DERIVED, NOT RESTATED. `BUTTON_VARIANTS`,
 * `CHIP_KINDS` and `ICON_NAMES` are the definitions the components themselves
 * are built from, so a variant added to `Button` appears here with no edit —
 * and `tests/gallery.spec.ts` holds the two curated lists (the token groups and
 * the type ladder) to their sheets, because those two cannot be derived in the
 * browser: CSS has no way to enumerate its own custom properties.
 *
 * IT IS NOT SHIPPED AS A FEATURE. The surface is announced by the host only
 * when `DSH_TASK_BOARD_DESIGN_PREVIEW=1`, so in a normal install the panel is
 * never registered and the shell never grows a row for it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { PALETTE } from '../../core/colors.ts'
import { ALL_STATUSES } from '../../core/tasks.ts'
import { STATUS_KEY } from '../board/status.ts'
import { BUTTON_TOGGLE_VARIANTS, BUTTON_VARIANTS, Button, Icon, ICON_BUTTON_SIZES, ICON_NAMES, IconButton, Section, Switch, type ButtonToggleVariant } from '../design/ui.tsx'
import { ColorSwatches, Disclosure, Segmented, SendModeToggle } from '../design/ui.tsx'
import components from '../design/components.module.css'
import { Field, Input, Select, TextArea } from '../design/Field.tsx'
import { Dialog } from '../design/Dialog.tsx'
import { CHIP_KINDS, Chip } from '../design/Chip.tsx'
import { AttachmentStrip, type AttachmentChip } from '../design/AttachmentStrip.tsx'
import { WorkbenchBar } from '../design/WorkbenchBar.tsx'
import { t } from '../locales.ts'
import { BANDS } from '../design/bands.ts'
import css from './gallery.module.css'

/**
 * How a token group is SHOWN.
 *
 * A colour is a dot; a radius is a corner you can see the roundness of; a
 * shadow is a lifted box; a distance is a bar of that length. Anything else is
 * text. Showing every token as a colour dot — which is what the first version
 * of this page did — puts a meaningless white square beside `--dsh-tb-radius-md`
 * and beside `--dsh-tb-space-4`, and a catalogue whose specimens do not match
 * their subjects teaches the reader to stop looking at the specimens.
 */
export type TokenKind = 'color' | 'radius' | 'shadow' | 'space' | 'plain'

/**
 * The design variables this page displays, GROUPED BY WHAT THEY ARE FOR.
 *
 * A curated catalogue rather than a dump: a reader wants 「表面有哪几级」, not
 * eighty names in declaration order. It is also the one list here that cannot
 * be derived — CSS cannot enumerate its own custom properties — so
 * `tests/gallery.spec.ts` reads every name below out of the design sheets and
 * fails when one is renamed or removed.
 */
export const GALLERY_TOKEN_GROUPS: readonly { readonly title: string; readonly why: string; readonly kind: TokenKind; readonly names: readonly string[] }[] = [
  {
    title: '表面',
    why: '画布可透、内层不透明。三个台阶，不多不少。',
    kind: 'color',
    names: ['--dsh-tb-bg', '--dsh-tb-bg-raised', '--dsh-tb-surface-float', '--dsh-tb-surface-sunken', '--dsh-tb-surface-menu', '--dsh-tb-chip-fill'],
  },
  {
    title: '墨色',
    why: '文字两档，层次靠字重；第三档 3.7:1，只画记号（折角、圆点、环）。禁用态用 opacity，不另开一个颜色。',
    kind: 'color',
    names: ['--dsh-tb-text-1', '--dsh-tb-text-2', '--dsh-tb-text-3'],
  },
  {
    title: '语义色',
    why: '一个色相一枚令牌，只许读它，不许派生第二枚。',
    kind: 'color',
    names: ['--dsh-tb-accent', '--dsh-tb-attention', '--dsh-tb-success', '--dsh-tb-danger'],
  },
  {
    title: '状态五档',
    why: '看板五栏与清单五档读同一组颜色——两处导入，不抄。',
    kind: 'color',
    names: ['--dsh-tb-status-backlog', '--dsh-tb-status-todo', '--dsh-tb-status-running', '--dsh-tb-status-review', '--dsh-tb-status-done'],
  },
  {
    title: '圆角与形状',
    why: '半径决定角多大，corner-shape 决定角是不是圆弧——两条轴。',
    kind: 'radius',
    names: ['--dsh-tb-radius-sm', '--dsh-tb-radius-md', '--dsh-tb-radius-lg', '--dsh-tb-radius-xl', '--dsh-tb-pill'],
  },
  {
    title: '阴影',
    why: '静息态是平的；阴影是状态的响应，不是身份的声明。',
    kind: 'shadow',
    names: ['--dsh-tb-shadow-1', '--dsh-tb-shadow-2', '--dsh-tb-shadow-3'],
  },
  {
    title: '间距阶梯',
    why: '一个 gap 要么读阶梯，要么是一次写明的测量。',
    kind: 'space',
    names: ['--dsh-tb-space-1', '--dsh-tb-space-2', '--dsh-tb-space-3', '--dsh-tb-space-4', '--dsh-tb-space-5', '--dsh-tb-space-6', '--dsh-tb-space-7', '--dsh-tb-space-8', '--dsh-tb-space-9'],
  },
  {
    title: '几何与动效',
    why: '量出来的数各自成令牌；动效只有一个时长，减弱动效把它归零。',
    kind: 'plain',
    names: ['--dsh-tb-button-h', '--dsh-tb-button-h-sm', '--dsh-tb-row-line', '--dsh-tb-hint-line', '--dsh-tb-dot', '--dsh-tb-hit-ring-block', '--dsh-tb-hit-ring-inline', '--dsh-tb-motion', '--dsh-tb-ring'],
  },
]

/**
 * The interface type ladder, as DESIGN.md states it.
 *
 * Literal sizes rather than tokens: the ladder is a RULE about which sizes the
 * interface may use, and the sheets apply it by writing those sizes. Declaring
 * tokens nothing consumes would be a third vocabulary for the same fact — see
 * `tests/gallery.spec.ts`, which checks each row against the sheets' own
 * declarations so this table cannot describe a ladder nobody uses.
 */
export const GALLERY_TYPE_LADDER: readonly { readonly label: string; readonly size: number; readonly weight: number; readonly where: string }[] = [
  { label: 'Title', size: 16, weight: 600, where: '板名、弹窗标题、详情与复核页主标题' },
  { label: 'Emphasis', size: 14, weight: 500, where: '卡片标题、详情正文、会话名、入口行' },
  { label: 'Control', size: 13, weight: 500, where: '按钮、输入框、下拉框、列名、次级标题' },
  { label: 'Body', size: 12, weight: 400, where: '界面主力：说明文字、列表行、芯片、状态行' },
  { label: 'Meta', size: 11, weight: 400, where: '时间戳、路径、徽标数字' },
]

/** The three widths the stage can be driven to, so the container query fires. */
const STAGE_BANDS: readonly { readonly label: string; readonly px: number | undefined }[] = [
  { label: '满宽', px: undefined },
  { label: '中档 900', px: 900 },
  { label: '窄档 640', px: 640 },
]

/** Read one custom property's resolved value off an element. */
function tokenValueOf(element: Element | null, name: string): string {
  if (element === null) return ''
  return getComputedStyle(element).getPropertyValue(name).trim()
}

/**
 * Render the design-system gallery.
 * @returns the catalogue page.
 */
export function DesignGallery() {
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [tokens, setTokens] = useState<Readonly<Record<string, string>>>({})
  const [band, setBand] = useState<number | undefined>(undefined)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [switchOn, setSwitchOn] = useState(true)
  // The composed specimens below are live: a fold that cannot fold and a group
  // that cannot change are pictures of the component, not the component.
  const [foldOpen, setFoldOpen] = useState(true)
  const [segment, setSegment] = useState('one')
  const [steer, setSteer] = useState(false)
  const [swatch, setSwatch] = useState<string | undefined>(PALETTE[0])
  // The attachment strip is shown with real chips so the removal key is the real
  // one: a specimen whose × does nothing is a drawing of the component.
  const [stripChips, setStripChips] = useState<readonly AttachmentChip[]>([
    { id: 'specimen:0', name: 'screenshot.png', bytes: 842_113 },
    { id: 'specimen:1', name: 'brief.pdf', bytes: 24_576 },
  ])

  // The values are read AFTER mount, from the element they apply to. Reading
  // them from the stylesheet at build time would show the layer's own text
  // (`var(--dsw-alias-bg-base)`) rather than the colour the host resolves it to
  // — and the colour is the fact a reader came for.
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const read: Record<string, string> = {}
    for (const group of GALLERY_TOKEN_GROUPS) {
      for (const name of group.names) read[name] = tokenValueOf(root, name)
    }
    setTokens(read)
  }, [])

  const applyBand = useCallback((px: number | undefined) => {
    setBand(px)
    const stage = stageRef.current
    if (stage === null) return
    if (px === undefined) stage.style.removeProperty('inline-size')
    else stage.style.setProperty('inline-size', `${px}px`)
  }, [])

  return (
    <div ref={rootRef} className={css.galleryRoot} data-dsh-taskboard-view="">
      <div className={css.galleryHead}>
        <h1 className={components.titleStep}>{t('gallery.title')}</h1>
        <p className={css.galleryNote}>{t('gallery.note')}</p>
        <div className={css.galleryHeadTools}>
          <Switch checked={switchOn} onChange={setSwitchOn} label={t('gallery.switch')} />
          <span className={css.galleryLabel}>{t('gallery.stage')}</span>
          {STAGE_BANDS.map(one => (
            <button
              key={one.label}
              type="button"
              className={css.galleryBandButton}
              aria-pressed={band === one.px}
              onClick={() => { applyBand(one.px) }}
            >
              {one.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={stageRef} className={css.galleryStage}>
        <div className={css.galleryBody}>
        {/* ── 设计变量 ───────────────────────────────────────────────────── */}
        <Section title={t('gallery.tokens')}>
          {GALLERY_TOKEN_GROUPS.map(group => (
            <div key={group.title}>
              <div className={css.gallerySectionHead}>
                <h3 className={css.gallerySectionTitle}>{group.title}</h3>
                <p className={css.gallerySectionWhy}>{group.why}</p>
              </div>
              <div className={css.galleryGrid}>
                {group.names.map(name => (
                  <div key={name} className={css.gallerySwatch}>
                    <span
                      className={css.gallerySpecimenBox}
                      data-kind={group.kind}
                      style={{ ['--gallery-value' as string]: `var(${name})` }}
                    />
                    <span className={css.gallerySwatchText}>
                      <span className={css.galleryLabel}>{name}</span>
                      <span className={css.galleryValue}>{tokens[name] === '' ? t('gallery.unread') : tokens[name]}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Section>

        {/* ── 字体 ───────────────────────────────────────────────────────── */}
        <Section title={t('gallery.type')}>
          <div className={css.galleryGrid}>
            {GALLERY_TYPE_LADDER.map(step => (
              <div key={step.label} className={css.gallerySpecimen}>
                <p className={css.galleryLabel}>{step.label} · {step.size}px / {step.weight}</p>
                <p className={css.galleryTypeSpecimen} style={{ fontSize: step.size, fontWeight: step.weight }}>
                  {t('gallery.typeSpecimen')}
                </p>
                <p className={css.galleryValue}>{step.where}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ── 按钮 ───────────────────────────────────────────────────────── */}
        <Section title={t('gallery.buttons')}>
          <div className={css.galleryGrid}>
            {BUTTON_VARIANTS.map(variant => (
              <div key={variant} className={css.gallerySpecimen}>
                <p className={css.galleryLabel}>{variant}</p>
                <div className={css.gallerySpecimenRow}>
                  <Button variant={variant}>{variant}</Button>
                  <Button variant={variant} size="sm">{variant}</Button>
                </div>
                <div className={css.gallerySpecimenRow}>
                  {/* THE TOGGLE STATE IS SHOWN ONLY WHERE IT EXISTS. `pressed` is
                      a ghost treatment, and on a filled variant it would render
                      white text on a transparent wash — 1.11:1, unreadable. The
                      button's props make that a compile error; this reads the
                      same definition so the specimen shows the truth instead of
                      a state the component refuses to have. */}
                  {(BUTTON_TOGGLE_VARIANTS as readonly string[]).includes(variant)
                    && <Button variant={variant as ButtonToggleVariant} pressed>{variant}</Button>}
                  <Button variant={variant} disabled>{variant}</Button>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── 工作台栏：三页共用的那一行 ─────────────────────────────────────
            两个状态并排摆出来，因为它们的差别正是这一栏的语义：有读数时状态行
            在右端，没有读数时右端只剩出口——而不是一条写着「0」的空读数。 */}
        <Section title={t('workbench.navLabel')}>
          <div className={css.galleryGrid}>
            <div className={css.gallerySpecimen}>
              <p className={css.galleryLabel}>3 destinations · status</p>
              <WorkbenchBar
                active="board"
                tabs={[
                  { id: 'home', label: t('workbench.tab.home') },
                  { id: 'board', label: t('workbench.tab.board'), badge: 3 },
                  { id: 'items', label: t('workbench.tab.items'), badge: 2 },
                ]}
                label={t('workbench.navLabel')}
                status={t('workbench.status', { n: '3', m: '1' })}
                exitLabel={t('workbench.exit')}
                onExit={() => undefined}
                onNavigate={() => undefined}
              />
            </div>
            <div className={css.gallerySpecimen}>
              <p className={css.galleryLabel}>3 destinations · quiet</p>
              <WorkbenchBar
                active="items"
                tabs={[
                  { id: 'home', label: t('workbench.tab.home') },
                  { id: 'board', label: t('workbench.tab.board') },
                  { id: 'items', label: t('workbench.tab.items') },
                ]}
                label={t('workbench.navLabel')}
                exitLabel={t('workbench.exit')}
                onExit={() => undefined}
                onNavigate={() => undefined}
              />
            </div>
          </div>
        </Section>

        {/* ── 图标按钮：档位从导出处读，加一档不用改这里 ───────────────────── */}
        <Section title={t('gallery.iconButtons')}>
          <div className={css.galleryGrid}>
            {ICON_BUTTON_SIZES.map(size => (
              <div key={size} className={css.gallerySpecimen}>
                <p className={css.galleryLabel}>{size}</p>
                <div className={css.gallerySpecimenRow}>
                  <IconButton size={size} label={`${size} icon`}><Icon name="close" /></IconButton>
                  <IconButton size={size} quiet label={`${size} quiet icon`}><Icon name="bell" /></IconButton>
                  <IconButton size={size} disabled label={`${size} disabled icon`}><Icon name="pencil" /></IconButton>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── 组合件：四件由别的组件拼出来的共用件 ───────────────────────────
            它们此前没有被预览过——组件标本是手写的，所以「加进设计系统」与
            「出现在这一页」之间没有任何东西连着。现在 `tests/gallery.spec.ts`
            数着这一条。每一格都渲染真件并且能用。 */}
        <Section title={t('gallery.composed')}>
          <div className={css.galleryGrid}>
            <div className={css.gallerySpecimen}>
              <p className={css.galleryLabel}>Disclosure</p>
              <div className={css.gallerySpecimenRow}>
                <Disclosure title={t('gallery.composedFold')} summary={foldOpen ? 'expanded' : 'collapsed'} open={foldOpen} onToggle={() => { setFoldOpen(!foldOpen) }}>
                  <p className={css.galleryNote}>{t('gallery.note')}</p>
                </Disclosure>
              </div>
            </div>
            <div className={css.gallerySpecimen}>
              <p className={css.galleryLabel}>Segmented</p>
              <div className={css.gallerySpecimenRow}>
                <Segmented ariaLabel={t('gallery.composedSegment')} value={segment} onChange={setSegment} options={[{ value: 'one', label: 'one' }, { value: 'two', label: 'two' }]} />
              </div>
              <div className={css.gallerySpecimenRow}>
                <Segmented ariaLabel={t('gallery.composedSegment')} disabled value="one" onChange={() => {}} options={[{ value: 'one', label: 'one' }, { value: 'two', label: 'two' }]} />
              </div>
            </div>
            <div className={css.gallerySpecimen}>
              <p className={css.galleryLabel}>SendModeToggle</p>
              <div className={css.gallerySpecimenRow}>
                <SendModeToggle steer={steer} onChange={setSteer} />
              </div>
            </div>
            <div className={css.gallerySpecimen}>
              <p className={css.galleryLabel}>ColorSwatches</p>
              <div className={css.gallerySpecimenRow}>
                <ColorSwatches value={swatch} onChange={setSwatch} />
              </div>
            </div>
            {/* 附件条自成一个标本：**它的忙闲那句话不属于它**（那一句由台账按在传什么
                给出来，见 `attachBusyLabel`），所以这里两行画的是同一件事的两半——读者
                能删掉的那条，与正在传的那条。 */}
            <div className={css.gallerySpecimen}>
              <p className={css.galleryLabel}>AttachmentStrip</p>
              <div className={css.gallerySpecimenRow}>
                <AttachmentStrip
                  attachments={stripChips}
                  onAdd={() => {}}
                  onRemove={id => { setStripChips(chips => chips.filter(chip => chip.id !== id)) }}
                />
              </div>
              <div className={css.gallerySpecimenRow}>
                <AttachmentStrip
                  attachments={[]}
                  onAdd={() => {}}
                  onRemove={() => {}}
                  busy
                  busyLabel={t('review.attachFileBusy')}
                />
              </div>
            </div>
          </div>
        </Section>

        {/* ── 表单字段：外壳、三种控件、错误态与说明 ──────────────────────────
            每一格都渲染真件，所以「题头的档位、控件的盒高、错误态的那条线」在这里
            就是它们在页面上的样子，而不是一份看起来像它们的仿制品。 */}
        <Section title={t('gallery.fields')}>
          <div className={css.galleryGrid}>
            <div className={css.gallerySpecimen}>
              <p className={css.galleryLabel}>Input</p>
              <Field label={t('gallery.typeSpecimen')}>
                <Input defaultValue={t('gallery.typeSpecimen')} readOnly />
              </Field>
            </div>
            <div className={css.gallerySpecimen}>
              <p className={css.galleryLabel}>Input + hint</p>
              <Field label={t('gallery.typeSpecimen')} hint={t('gallery.note')}>
                <Input defaultValue="" placeholder={t('gallery.typeSpecimen')} readOnly />
              </Field>
            </div>
            <div className={css.gallerySpecimen}>
              <p className={css.galleryLabel}>Input invalid</p>
              <Field label={t('gallery.typeSpecimen')}>
                <Input invalid defaultValue="not a cron" readOnly />
              </Field>
            </div>
            <div className={css.gallerySpecimen}>
              <p className={css.galleryLabel}>TextArea</p>
              <Field label={t('gallery.typeSpecimen')}>
                {/* A SHORT value, and that is the specimen's whole job: a
                    textarea given more text than it has rows renders as a
                    clipped box, and the eye reads that as the CONTROL being
                    broken rather than the sample being too long. */}
                <TextArea rows={2} defaultValue={t('gallery.typeSpecimen')} readOnly />
              </Field>
            </div>
            <div className={css.gallerySpecimen}>
              <p className={css.galleryLabel}>Select</p>
              <Field label={t('gallery.typeSpecimen')}>
                {/* NOT disabled: a disabled select is greyed, so the specimen
                    would show a state the control does not normally have — and
                    the chevron it exists to show would be dimmed with it. */}
                <Select defaultValue="a">
                  <option value="a">{t('gallery.typeSpecimen')}</option>
                  <option value="b">{t('gallery.note')}</option>
                </Select>
              </Field>
            </div>
          </div>
        </Section>

        {/* ── 芯片 ───────────────────────────────────────────────────────── */}
        <Section title={t('gallery.chips')}>
          <div className={css.gallerySpecimenRow}>
            {CHIP_KINDS.map(kind => <Chip key={kind} kind={kind}>{kind}</Chip>)}
          </div>
          <div className={css.gallerySpecimenRow}>
            {CHIP_KINDS.map(kind => <Chip key={kind} kind={kind} fill={false}>{kind}</Chip>)}
          </div>
          <div className={css.gallerySpecimenRow}>
            {CHIP_KINDS.map(kind => <Chip key={kind} kind={kind} icon={<Icon name="check" />}>{kind}</Chip>)}
          </div>
        </Section>

        {/* ── 状态五档（两个面板导入的同一组） ─────────────────────────────── */}
        <Section title={t('gallery.statuses')}>
          <div className={css.gallerySpecimenRow}>
            {ALL_STATUSES.map(status => <Chip key={status} kind="neutral">{t(STATUS_KEY[status])}</Chip>)}
          </div>
          <div className={css.gallerySpecimenRow}>
            {ALL_STATUSES.map(status => (
              <span key={status} className={css.gallerySwatch}>
                <span className={css.gallerySpecimenBox} data-kind="color" style={{ ['--gallery-value' as string]: `var(--dsh-tb-status-${status})` }} />
                <span className={css.galleryLabel}>{status}</span>
              </span>
            ))}
          </div>
        </Section>

        {/* ── 图标 ───────────────────────────────────────────────────────── */}
        <Section title={t('gallery.icons')}>
          <div className={css.gallerySpecimenRow}>
            {ICON_NAMES.map(name => (
              <span key={name} className={css.gallerySwatch}>
                <Icon name={name} />
                <span className={css.galleryLabel}>{name}</span>
              </span>
            ))}
          </div>
        </Section>

        {/* ── 调色板（数据色，不是语义色） ─────────────────────────────────── */}
        <Section title={t('gallery.palette')}>
          <div className={css.gallerySpecimenRow}>
            {PALETTE.map(colour => (
              <span key={colour} className={css.gallerySwatch}>
                <span className={css.gallerySpecimenBox} data-kind="color" style={{ ['--gallery-value' as string]: colour }} />
                <span className={css.galleryLabel}>{colour}</span>
              </span>
            ))}
          </div>
        </Section>


        {/* ── 断点表 ─────────────────────────────────────────────────────── */}
        <Section title={t('gallery.bands')}>
          <div className={css.galleryGrid}>
            {Object.entries(BANDS).map(([group, bands]) => (
              <div key={group} className={css.gallerySpecimen}>
                <p className={css.galleryLabel}>{group}</p>
                {bands.map(one => (
                  <p key={`${one.container}@${one.narrowMax}`} className={css.galleryValue}>
                    {one.container} ≤ {one.narrowMax}px — {one.what}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </Section>

        {/* ── 浮层：真的能点开 ───────────────────────────────────────────── */}
        <Section title={t('gallery.overlay')}>
          <div className={css.gallerySpecimenRow}>
            <Button variant="primary" onClick={() => { setDialogOpen(true) }}>{t('gallery.openDialog')}</Button>
            <span className={css.galleryValue}>
              {dialogOpen ? t('gallery.dialogOpen') : t('gallery.dialogClosed')}
            </span>
          </div>
        </Section>
        </div>
      </div>

      {/* The real dialog, portal and all: Escape closes it through the shared
          stack, focus is trapped inside it, and the backdrop is the same rule
          every other overlay in the plugin rides. A gallery that drew its own
          box here would be showing a picture of a dialog. */}
      {dialogOpen && (
        <Dialog title={t('gallery.openDialog')} label={t('gallery.openDialog')} onClose={() => { setDialogOpen(false) }}>
          <p className={css.galleryValue}>{t('gallery.dialogBody')}</p>
          <div className={css.gallerySpecimenRow}>
            <Button variant="ghost" onClick={() => { setDialogOpen(false) }}>{t('gallery.closeDialog')}</Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
