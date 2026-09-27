#!/usr/bin/env node
/**
 * verify-action-coverage.mjs — the runtime half of the action-catalog contract.
 *
 * src/core/board-actions.ts already fails the BUILD when a task-patch field has
 * no verdict (`Record<keyof TaskUpdatePatch, FieldSpec>`). That is the compile-
 * time half. This script is the other half, and it exists for the direction a
 * type cannot see: someone adds a button to the board, the build is still green,
 * and the model was never told. The catalog is the one table four surfaces are
 * rendered from (tool schema, capability query, prompt rules, and this check);
 * a hand-written fourth table always drifts, so this gate reads the real files
 * and reports the gap by name.
 *
 * WHAT IT CHECKS, in the order that matters:
 *
 *  1. COVERAGE, both directions of the receiver. Every call to a public
 *     BoardController method must resolve to an action in the catalog, or to an
 *     INTERNAL entry that carries a reason. A method with neither is the exact
 *     "the UI grew something the model was never told about" case.
 *  2. SEMANTIC HONESTY, both directions. A `semantic` action must name a shared
 *     core function that is really exported, and a function that really exists
 *     must NOT be reported — otherwise the cheapest fix for a finding is to
 *     delete the rule, which is how a gate dies.
 *  3. CATALOG COHERENCE: verbs inside the twelve, surfaces inside the three,
 *     no id written twice, no parameter claiming both `optional` and
 *     `requiredWhen`.
 *  4. DOC/CODE AGREEMENT: if AGENTS.md tells an AI to put new actions in the
 *     catalog and the catalog is gone, that is a red build — the rule outlived
 *     the thing it rules.
 *
 * NO SKIP PATH. This gate reads only this repository, so unlike
 * verify-design-docs.mjs (which SKIPs and exits 0 when the DSH install cannot be
 * located, a green that means "unverified") there is nothing here that can be
 * absent. A missing catalog, a missing controller, an empty file list, or a
 * parser that extracted nothing are all FINDINGS, never quiet passes: a gate
 * that reports success because it ran on empty input is worse than no gate.
 *
 * Deliberately NOT checked yet, and when each arrives:
 *  - that every action has a HANDLERS implementation — HANDLERS does not exist
 *    yet; it is the action->method table's real home, and this script's
 *    ACTION_METHODS below is what it will replace (see the note on it).
 *  - that the rendered tool schema matches the catalog — the renderer does not
 *    exist yet; until it does there is nothing to compare, and guessing at its
 *    shape would only lock in a wrong interface.
 *
 * usage: node scripts/verify-action-coverage.mjs [plugin-dir]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The twelve verbs, restated as DATA so this gate does not import the TS
 *  module (node cannot load TypeScript) — and so a mismatch is a finding rather
 *  than a crash. The script also compares the catalog's own BOARD_VERBS against
 *  this list, so the two copies cannot quietly disagree. */
const CONTRACT_VERBS = [
  'create', 'update', 'move', 'delete', 'run', 'speak', 'bind',
  'automate', 'cruise', 'ack', 'navigate', 'query',
]

/** Who can reach an action. Three states, exhaustively (board-actions.ts). */
const CONTRACT_SURFACES = ['ui', 'ui+ai', 'ai-only']

/** Receivers that ARE a BoardController. `this` counts: the controller calls
 *  its own public methods, and an internal caller reaching a verb the model was
 *  never told about is the same drift one layer down. */
const CONTROLLER_RECEIVERS = new Set(['controller', 'this'])

/**
 * Call sites on a receiver that is NOT the board controller, keyed
 * `receiver.method`, each with why. These are the generic names — `subscribe`,
 * `dispose`, `start`, `getSnapshot` — that other objects in the wiring happen
 * to share with it. The exemption is per CALL, not per receiver, so a genuine
 * `someObject.moveTask(` is still caught even if `someObject` is on this list.
 * A new one is a deliberate, visible act: an unclassified call is a finding.
 */
const FOREIGN_CALLS = {
  'ctx.pendingInteractionOf': 'the host uiSession service, not the board controller',
  'freshness.subscribe': 'the bundle-freshness watcher',
  'questionTracker.dispose': 'the question tracker (pluginPage lifecycle)',
  'scheduler.dispose': 'the board scheduler',
  'scheduler.start': 'the board scheduler',
  'session.getSnapshot': 'the sessions list store',
  'session.subscribe': 'the sessions list store',
  'source.subscribe': 'the comment-draft source store',
  'sync.dispose': 'the host-sync engine',
  'sync.isEngine': 'the host-sync engine',
  'sync.start': 'the host-sync engine',
  'uiWorkspace.openSession': 'the host workspace service',
}

/**
 * Which action each covered controller method carries. Keys are action ids in
 * the catalog — so a typo on the id side is a finding, and a method claimed by
 * two actions is a finding.
 *
 * WHY THIS TABLE IS HERE AND NOT IN THE CATALOG: the executable binding belongs
 * to HANDLERS, the action->implementation table, which does not exist yet (see
 * the header). Until it does, the catalog describes actions and this file binds
 * them to methods; when HANDLERS lands, that table becomes the single source and
 * this one is deleted rather than kept in step. Keeping a second binding "just
 * in case" is the drift this whole gate exists to prevent.
 */
const ACTION_METHODS = {
  'task.create': ['createTask', 'createBoundTask'],
  'task.duplicate': ['copyTask'],
  'task.update': ['updateTask', 'setTaskColor'],
  'task.move': ['moveTask'],
  'task.approve': ['approveTask'],
  'task.delete': ['deleteTask'],
  'task.schedule': ['setSchedule'],
  'task.run': ['runTask', 'rerunTask'],
  'task.comment': ['submitComment', 'submitSessionComment', 'steerComment', 'steerCommentWithImages'],
  'task.cancelComment': ['cancelComment'],
  'task.ack': ['markTaskViewed', 'markTasksViewed', 'markExecutionViewed', 'markTaskSessionViewed'],
  'task.navigate': ['openTask', 'openTaskFromNotification', 'closeTask'],
  'board.cruise': ['setCruiseEnabled', 'setCruiseLimit', 'setCruiseSchedule'],
  'board.navigate': ['openBoard', 'closeBoard', 'showConversation'],
  'rule.create': ['createSessionRule'],
  'rule.update': ['updateSessionRule', 'toggleSessionRule'],
  'rule.delete': ['deleteSessionRule'],
  'session.bind': ['addTaskSources'],
  'session.remove': ['removeTaskSession'],
  'session.rename': ['renameTaskSession'],
  'session.reorder': ['reorderTaskSession'],
  'session.hide': ['hideTaskSession', 'unhideTaskSession', 'unhideTaskSessions'],
  'session.navigate': ['openSession'],
  'preset.create': ['saveTemplate'],
  'preset.delete': ['deleteTemplate'],
}

/**
 * Everything else the UI calls, each with a reason. The reason is not
 * decoration: an unclassified method is reported by name, so this table is the
 * difference between "the model was never told, on purpose" and "nobody
 * noticed".
 *
 * A reason that starts with DEBT marks a method that IS a user-facing change the
 * catalog does not carry yet. Those are the honest gaps: a board feature a
 * person can use and the model cannot, parked here with a reason instead of
 * being quietly filed under "not an action". Every run prints how many there
 * are, so the count cannot rot into invisibility.
 */
const DEBT = 'DEBT: '
const INTERNAL = {
  // --- read projections: they change nothing, so they are not actions ---------
  getSnapshot: '读投影：整份看板快照',
  linkedOf: '读投影：卡上的会话行',
  sessionsOf: '读投影：这张卡的会话列表',
  sessionTitle: '读投影：会话显示名',
  sessionInfo: '读投影：会话静态信息',
  sessionConfig: '读投影：会话当前配置（活投影）',
  sessionLabelsOf: '读投影：工作区归属标签',
  sessionActiveOf: '读投影：会话是否还在工作（活性层）',
  sessionAvailability: '读投影：会话是否可用（唯一判据）',
  pendingInteractionOf: '读投影：挂起的交互',
  questionPendingOf: '读投影：待作答的问题',
  relatedSessionIdSet: '读投影：相关会话集合',
  externalKindOf: '读投影：这条 id 是不是从侧栏拖进来的外源',
  boundSourceTitleOf: '读投影：绑源的显示名',
  offerableSessionGroups: '读投影：可选会话的分组',
  goalVerbs: '读投影：目标相关动词（走原生外壳）',
  listTemplates: '读投影：预设列表',
  presetStore: '读投影：排期预设库',
  runPresetStore: '读投影：运行配置预设库',
  runCatalog: '读投影：斜杠命令目录',
  referenceSources: '读投影：引用来源表',
  referenceSessionOf: '读投影：这张卡引用的会话',
  referenceSessionCatalog: '读投影：引用会话目录',
  loadTranscript: '读投影：会话尾部',
  loadTranscriptPage: '读投影：更早一页会话',
  loadImage: '读投影：图片字节（只读，不落盘）',
  canRecheckSeat: '读投影：能不能重查更新席位',
  // --- subscriptions and lifecycle: wiring, not verbs -------------------------
  subscribe: '订阅：快照变化通知',
  subscribeQuestions: '订阅：问题变化通知',
  subscribeGoalActivation: '订阅：目标上下膛通知',
  start: '生命周期：装配时启动',
  dispose: '生命周期：effect 清理时释放',
  // --- sync and engine plumbing: nobody clicks these --------------------------
  applyRemote: '同步：并入远端写入（永不回写）',
  setHostProto: '同步：协商协议代次',
  setHostBoot: '同步：记录宿主启动时刻',
  setEngine: '同步：记录本机是否持引擎',
  applyScheduleNextRun: '调度器回报：给排期盖下一跳的戳',
  setSchedulerHeartbeat: '调度器回报：心跳时刻',
  setSchedulerSkips: '调度器回报：跳过档期统计',
  tickCruise: '定时器驱动：巡航心跳',
  tickSessionRules: '定时器驱动：会话规则心跳',
  fireLoopRule: '定时器驱动：on-complete 续跑（界面无对应按钮）',
  fireOnCompleteRules: '定时器驱动：跑完触发（界面无对应按钮）',
  sendSessionMessage: '底层投递：评论与规则共用它，界面不直接调用',
  recordNativeTurn: '观测记账：原生侧跑完一轮（不是人点的动作）',
  recordActivityWake: '观测记账：原生侧活动唤醒（不是人点的动作）',
  // --- catalog debt: real user-facing changes the catalog does not carry yet --
  createTaskSession: DEBT + '按运行配置新建一条会话：人能在「新建会话」里做，目录还没有对应条目',
  answerQuestion: DEBT + '作答挂起的问题：人能在交互卡里做，目录还没有对应条目',
  cancelQuestion: DEBT + '取消挂起的问题：人能在交互卡里做，目录还没有对应条目',
  recheckSeat: DEBT + '检查更新并安装：人能在板头做，目录还没有对应条目',
  uploadFile: DEBT + '上传附件：模型手里没有上传通道（与图片字段 forbidden 同源）',
}

/** Scan roots: the UI half plus the controller, because the controller calls
 *  its own public methods too and a verb reachable only from in there is still
 *  a verb the model was never told about. */
const SCAN_ROOTS = ['src/client', 'src/core/controller.ts']

const failures = []
const notes = []

const fail = message => failures.push(message)

/** Read the public method names off a controller class. The method set is a
 *  FACT read from the code, not a hand-typed list: a list would need editing
 *  every time a method is added, and forgetting is the exact failure this gate
 *  is for. Returns also the private/protected names, so `this.` calls into the
 *  class internals are not mistaken for public surface. */
function controllerMethods(source) {
  const at = source.indexOf('export class BoardController')
  if (at === -1) return null
  const body = source.slice(at)
  const hidden = new Set()
  for (const m of body.matchAll(/^ {2}(?:private|protected)\s+(?:readonly\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)/gm)) hidden.add(m[1])
  const members = new Set()
  for (const m of body.matchAll(/^ {2}(?:(?:public|private|protected|readonly|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/gm)) {
    members.add(m[1])
  }
  const publicMethods = [...members].filter(name => !hidden.has(name) && name !== 'constructor').sort()
  if (publicMethods.length === 0) return null
  return publicMethods
}

/**
 * The catalog, read out of its source. node cannot import TypeScript, so this
 * is a targeted text extraction — and a targeted extraction that silently finds
 * nothing is the failure mode that kills a gate, so every step below is
 * load-bearing and verified against a count.
 */
function readCatalog(source) {
  const start = source.indexOf('export const ACTIONS')
  if (start === -1) return null
  const end = source.indexOf('} as const satisfies', start)
  if (end === -1) return null
  const table = source.slice(start, end)

  // An id line is a two-space-indented quoted key. Counting the lines and the
  // entries separately is what makes a drifted pattern loud: if the two ever
  // disagree, the parser moved and the run must not pass.
  const idLines = [...table.matchAll(/^ {2}'([a-z]+\.[A-Za-z]+)':\s*\{/gm)]
  const actions = []
  for (let i = 0; i < idLines.length; i++) {
    const from = idLines[i].index + idLines[i][0].length
    const to = i + 1 < idLines.length ? idLines[i + 1].index : table.length
    const block = table.slice(from, to)
    const verb = /^\s{4}verb:\s*'([^']*)'/m.exec(block)
    const surface = /^\s{4}surface:\s*'([^']*)'/m.exec(block)
    const semantic = /^\s{4}semantic:\s*true\b/m.test(block)
    const semanticOf = /^\s{4}semanticOf:\s*'([^']*)'/m.exec(block)
    const paramsAt = /^\s{4}params:\s*\{/m.exec(block)
    let params = []
    if (paramsAt !== null) {
      const paramsFrom = paramsAt.index + paramsAt[0].length
      const rest = block.slice(paramsFrom)
      // The params block ends at its own four-space closing brace. Slicing to
      // the end of the action block instead would let the NEXT action's
      // entries in, and the two are indistinguishable by indentation alone.
      const paramsEnd = /\n {4}\}/.exec(rest)
      const paramsText = paramsEnd === null ? rest : rest.slice(0, paramsEnd.index)
      // A parameter entry is a six-space-indented key (params is at four), so
      // an action block with parameters but none found means THIS parser moved
      // — and a check that silently stopped matching is worse than no check.
      if (paramsText.trim() !== '' && paramsText.trim() !== '}') {
        const entries = [...paramsText.matchAll(/^ {6}([A-Za-z_$][\w$]*):\s*\{/gm)]
        if (entries.length === 0) {
          fail(`${id}: the params block is not empty but no parameters were read from it — this parser no longer understands the catalog's shape, so every parameter check below would pass on nothing`)
        }
        for (let p = 0; p < entries.length; p++) {
          const pFrom = entries[p].index + entries[p][0].length
          const pTo = p + 1 < entries.length ? entries[p + 1].index : paramsText.length
          const spec = paramsText.slice(pFrom, pTo)
          // Not anchored to a line: a ParamSpec is usually written on one line,
          // and requiring `optional:` at the start of a line matched nothing.
          params.push({
            name: entries[p][1],
            optional: /\boptional:\s*true\b/.test(spec),
            requiredWhen: /\brequiredWhen:\s*'([^']*)'/.exec(spec)?.[1],
            appliesWhen: /\bappliesWhen:\s*'([^']*)'/.exec(spec)?.[1],
          })
        }
      }
    }
    actions.push({
      id: idLines[i][1],
      verb: verb === null ? undefined : verb[1],
      surface: surface === null ? undefined : surface[1],
      semantic,
      semanticOf: semanticOf === null ? undefined : semanticOf[1],
      params,
    })
  }
  if (actions.length === 0 || actions.length !== idLines.length) return null

  const verbsAt = /BOARD_VERBS:\s*readonly BoardVerb\[\]\s*=\s*\[([\s\S]*?)\]/.exec(source)
  const verbs = verbsAt === null ? [] : [...verbsAt[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort()
  return { actions, verbs, ids: actions.map(a => a.id) }
}

/** Exported names across the core layer — what a `semanticOf` must resolve to. */
function coreExports(files) {
  const names = new Set()
  for (const file of files) {
    for (const m of file.text.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class|enum)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
    for (const m of file.text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim()
        if (name !== undefined && name !== '') names.add(name)
      }
    }
  }
  return names
}

/** Every `receiver.method(` call in the scan roots, restricted to methods that
 *  are really controller methods. */
function callSites(files, publicMethods) {
  const known = new Set(publicMethods)
  const sites = []
  for (const file of files) {
    for (const m of file.text.matchAll(/(?:^|[^\w.$])([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z][\w]*)\s*\(/g)) {
      if (!known.has(m[2])) continue
      const line = file.text.slice(0, m.index).split('\n').length
      sites.push({ file: file.path, line, receiver: m[1], method: m[2] })
    }
  }
  return sites
}

/** Covered method -> action id, plus the two-sided complaint about the table. */
function methodBindings(ids, bindings) {
  const byAction = new Map()
  const claimedBy = new Map()
  for (const [id, methods] of Object.entries(bindings)) {
    byAction.set(id, methods)
    for (const method of methods) {
      if (!claimedBy.has(method)) claimedBy.set(method, [])
      claimedBy.get(method).push(id)
    }
  }
  for (const id of Object.keys(bindings)) {
    if (!ids.includes(id)) fail(`ACTION_METHODS binds methods to "${id}", which is not an action in the catalog (typo, or the action was renamed — the catalog is the authority)`)
  }
  for (const [method, owners] of claimedBy) {
    if (owners.length > 1) fail(`${method} is claimed by two actions (${owners.join(', ')}) — one method implements one verb; a second claim means one of them is describing the wrong thing`)
  }
  return claimedBy
}

/**
 * Everything the gate believes, in one pure function. No fs, no process.
 *
 * The three tables are injectable, exactly like `CatalogChecks` in
 * board-actions.ts: the tests feed deliberately broken copies and assert each
 * check bites, because a check that has only ever passed is indistinguishable
 * from a check that cannot fail. A table that could only be overridden by
 * editing this file would make that discipline impossible.
 */
export function actionCoverageFindings(input) {
  failures.length = 0
  notes.length = 0

  const bindings = input.bindings ?? ACTION_METHODS
  const internal = input.internal ?? INTERNAL
  const foreign = input.foreign ?? FOREIGN_CALLS
  const receivers = input.receivers ?? CONTROLLER_RECEIVERS

  const catalog = readCatalog(input.catalogText)
  if (catalog === null) {
    fail('cannot read the action catalog out of src/core/board-actions.ts — the ACTIONS table or its `as const satisfies` tail was not found, so nothing below could be checked. This is a FINDING, not a skip: a gate that cannot read its input must never report success')
    return failures.slice()
  }
  const publicMethods = controllerMethods(input.controllerText)
  if (publicMethods === null) {
    fail('cannot read the public method list out of src/core/controller.ts — the BoardController class or its members were not found, so every coverage check below would have passed on an empty input')
    return failures.slice()
  }
  if (input.scanFiles.length === 0) {
    fail('no source files were found to scan — coverage would pass on empty input')
    return failures.slice()
  }

  // 3. catalog coherence
  for (const verb of catalog.verbs) {
    if (!CONTRACT_VERBS.includes(verb)) fail(`BOARD_VERBS lists "${verb}", which is outside the twelve the contract declares`)
  }
  if (catalog.verbs.length !== CONTRACT_VERBS.length) {
    fail(`BOARD_VERBS has ${catalog.verbs.length} entries; the contract has ${CONTRACT_VERBS.length} — the two lists must be the same list`)
  }
  const seen = new Set()
  for (const action of catalog.actions) {
    if (seen.has(action.id)) fail(`action id "${action.id}" is written more than once in ACTIONS — an object literal silently keeps the last one, so a duplicated id is invisible to the compiler`)
    seen.add(action.id)
    if (action.verb === undefined) fail(`${action.id}: no verb could be read — the catalog's shape moved under this parser`)
    else if (!CONTRACT_VERBS.includes(action.verb)) fail(`${action.id}: verb "${action.verb}" is not one of the twelve`)
    if (action.surface === undefined) fail(`${action.id}: no surface could be read — the catalog's shape moved under this parser`)
    else if (!CONTRACT_SURFACES.includes(action.surface)) fail(`${action.id}: surface "${action.surface}" is not one of ${CONTRACT_SURFACES.join(' / ')}`)
    // 2. semantic honesty, and the reverse direction is the point of the pair
    if (action.semantic && (action.semanticOf === undefined || action.semanticOf === '')) {
      fail(`${action.id}: marked semantic without naming the shared core function (semanticOf) — the UI and the tool would each be free to grow their own`)
    } else if (action.semantic && action.semanticOf !== undefined && !input.coreExportNames.includes(action.semanticOf)) {
      fail(`${action.id}: claims semanticOf "${action.semanticOf}", which src/core/ does not export — a semantic action must name a function that really exists`)
    } else if (!action.semantic && action.semanticOf !== undefined) {
      fail(`${action.id}: names semanticOf "${action.semanticOf}" without being marked semantic`)
    }
    for (const param of action.params) {
      if (param.optional && param.requiredWhen !== undefined) {
        fail(`${action.id}.${param.name}: declared both optional and requiredWhen — pick one, or a schema renderer prints both and the caller cannot tell which is true`)
      }
      if (param.requiredWhen !== undefined && param.requiredWhen.trim() === '') {
        fail(`${action.id}.${param.name}: requiredWhen is empty — say the condition or drop the field`)
      }
      if (param.appliesWhen !== undefined && param.appliesWhen.trim() === '') {
        fail(`${action.id}.${param.name}: appliesWhen is empty — say the condition or drop the field`)
      }
    }
  }

  // 1. coverage, both directions of the receiver
  const claimedBy = methodBindings(catalog.ids, bindings)
  const sites = callSites(input.scanFiles, publicMethods)
  const used = new Map()
  for (const site of sites) {
    const isControllerReceiver = receivers.has(site.receiver)
    const key = `${site.receiver}.${site.method}`
    if (!isControllerReceiver) {
      if (foreign[key] === undefined) {
        fail(`${site.file}:${site.line}: ${key} calls a controller method name on a receiver this gate does not recognize. If it is the board controller, add the receiver to CONTROLLER_RECEIVERS; if it is something else that happens to share the name, add this call to FOREIGN_CALLS with a reason. An unclassified receiver is how a renamed prop stops being checked`)
      }
      continue
    }
    if (!used.has(site.method)) used.set(site.method, site)
    if (claimedBy.has(site.method)) continue
    const reason = internal[site.method]
    if (reason === undefined) {
      fail(`${site.file}:${site.line}: controller.${site.method}() is neither an action in src/core/board-actions.ts nor an INTERNAL entry with a reason — this is the "the UI grew something the model was never told about" case. Add it to the catalog as an action, or to INTERNAL with the reason it is not one`)
    } else if (reason.trim() === '') {
      fail(`INTERNAL.${site.method} has an empty reason — an unexplained exclusion is indistinguishable from a forgotten one`)
    }
  }
  // A method cannot be both an action and a declared non-action: the two
  // statements contradict, and whichever one the reader believes first, the
  // other is a lie. Caught in both directions of the tables.
  for (const method of Object.keys(internal)) {
    if (claimedBy.has(method)) {
      fail(`${method} is listed in INTERNAL (as not an action) and bound to the action "${claimedBy.get(method).join(', ')}" — decide which one it is; a table that says both is a table nobody can read`)
    }
  }
  for (const [id, methods] of Object.entries(bindings)) {
    for (const method of methods) {
      if (!publicMethods.includes(method)) {
        fail(`ACTION_METHODS: "${id}" binds "${method}", which is not a public method of BoardController — either the method was renamed or the binding is stale`)
      }
    }
  }

  // 4. doc/code agreement
  const mentionsCatalog = /board-actions\.ts/.test(input.agentsText)
  const catalogPresent = input.presentFiles.includes('src/core/board-actions.ts')
  if (mentionsCatalog && !catalogPresent) {
    fail('AGENTS.md tells the AI to register new actions in src/core/board-actions.ts, but that file does not exist — a rule that outlived the thing it rules')
  }
  if (!mentionsCatalog && catalogPresent) {
    notes.push('the action catalog exists but AGENTS.md never names it — a rule nobody can follow is as good as no rule')
  }
  if (!mentionsCatalog) {
    notes.push('AGENTS.md says nothing about the action catalog, so the doc/code agreement check has nothing to compare')
  }

  const debt = Object.entries(internal).filter(([, reason]) => reason.startsWith(DEBT)).length
  const paramCount = catalog.actions.reduce((sum, a) => sum + a.params.length, 0)
  notes.push(`catalog: ${catalog.actions.length} actions, ${catalog.verbs.length} verbs, ${paramCount} parameters read, ${publicMethods.length} public controller methods`)
  notes.push(`coverage: ${used.size} controller method(s) called across ${input.scanFiles.length} file(s); ${claimedBy.size} bound to an action, ${Object.keys(internal).length} INTERNAL (${debt} marked catalog debt)`)
  notes.push(`semantic: ${catalog.actions.filter(a => a.semantic).length} semantic action(s) checked against ${input.coreExportNames.length} core export(s)`)
  if (debt > 0) notes.push(`catalog debt: ${debt} user-facing method(s) are parked in INTERNAL with a DEBT reason — visible on every run so the gap cannot rot into invisibility`)
  return failures.slice()
}

/** Read the repository into the input shape. Separated from the findings so the
 *  tests can feed the checks broken copies instead of a broken checkout. */
export function readRepo(root) {
  const at = (...parts) => join(root, ...parts)
  const read = path => readFileSync(at(...path.split('/')), 'utf8')
  const coreDir = at('src', 'core')
  const coreFiles = existsSync(coreDir)
    ? readdirSync(coreDir).filter(name => name.endsWith('.ts')).map(name => ({ path: `src/core/${name}`, text: readFileSync(join(coreDir, name), 'utf8') }))
    : []
  const scanFiles = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(entry.name)) scanFiles.push({ path: relative(root, p).split(sep).join('/'), text: readFileSync(p, 'utf8') })
    }
  }
  for (const rootPath of SCAN_ROOTS) {
    const p = at(...rootPath.split('/'))
    if (!existsSync(p)) continue
    if (/\.tsx?$/.test(rootPath)) scanFiles.push({ path: rootPath, text: readFileSync(p, 'utf8') })
    else walk(p)
  }
  const presentFiles = []
  const markPresent = rel => { if (existsSync(at(...rel.split('/')))) presentFiles.push(rel) }
  markPresent('src/core/board-actions.ts')
  markPresent('AGENTS.md')
  return {
    catalogText: existsSync(coreDir) ? (readdirSync(coreDir).includes('board-actions.ts') ? read('src/core/board-actions.ts') : '') : '',
    controllerText: existsSync(at('src', 'core', 'controller.ts')) ? read('src/core/controller.ts') : '',
    scanFiles,
    coreExportNames: [...coreExports(coreFiles)],
    agentsText: existsSync(at('AGENTS.md')) ? readFileSync(at('AGENTS.md'), 'utf8') : '',
    presentFiles,
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  const root = resolve(process.argv[2] ?? '.')
  const findings = actionCoverageFindings(readRepo(root))
  if (findings.length > 0) {
    console.error(`verify-action-coverage FAILED (${findings.length})`)
    for (const f of findings) console.error('  - ' + f)
    for (const n of notes) console.error('  context: ' + n)
    console.error('  Every one of these is a gap between what the board can do and what the model was told it can do.')
    console.error('  Fix it by registering the action in src/core/board-actions.ts, or by declaring why the method is not an action.')
    process.exit(1)
  }
  for (const n of notes) console.log('note: ' + n)
  console.log('verify-action-coverage OK: every controller method the UI calls is either a catalog action or a declared non-action, and the catalog is self-consistent')
}
