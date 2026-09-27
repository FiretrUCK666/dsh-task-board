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
  'session.create': ['createTaskSession'],
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
 * A reason's PREFIX is the verdict, and the two marked ones must never be
 * confused — that confusion is the whole cost of parking a real action here:
 *
 *   (no prefix)          it is not an action at all: a read projection, a view
 *                        switch, a subscription, sync or engine wiring.
 *   DEBT:                it IS a user-facing action the catalog does not carry
 *                        YET — we FORGOT. The thing to do is add it.
 *   NOT-FOR-THE-MODEL:   it IS a user-facing action and we have DECIDED the
 *                        model does not get it. The thing to do is nothing.
 *
 * Every run prints the two marked groups separately, with their counts, and
 * never as one number: a decision and an oversight summed together read as
 * "somebody forgot", and a deliberate product call should never look like that.
 * The mechanism is kept even while the count is zero, because zero is a
 * statement about today and the next action added without a catalog entry
 * lands right back in it.
 */
const DEBT = 'DEBT: '
const NOT_FOR_MODEL = 'NOT-FOR-THE-MODEL: '
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
  liveStateOf: '读投影：这张卡此刻的活性判决（三值，panel 只在明确 `running` 时显示进行中，看不见的 `unknown` 不写成在跑）。任务清单的「在不在跑」只从这里取——同一个问题只许有一个答案。',
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
  // --- deliberately NOT offered to the model: real actions, product decisions -
  // Each one IS a thing a person can do from the board, and none of them is in
  // the catalog. That is a decision, not an oversight, and the reason has to
  // survive the next person who reads the table: the tempting fix for "the
  // catalog is missing this" is to invent a verb for it, and an invented verb
  // teaches the next reader a false thing about that verb.
  recheckSeat: NOT_FOR_MODEL + '检查更新并安装：十二个动词里没有一个是真的——塞进 `run` 等于教下一个读表的人「run 不等于跑卡」。诚实的错配比一个会骗人的动词好。',
  uploadFile: NOT_FOR_MODEL + '上传附件：对应 `TASK_FIELDS` 里 `promptImages` / `promptFiles` 的 `forbidden` 裁决——模型手里没有上传通道，凭空的图片或文件引用等于一条画不出来的内容。',
  answerQuestion: NOT_FOR_MODEL + '作答挂起的问题：作答是「人看过」的陈述，模型替人作答等于替人关掉自己的门——与 `task.ack`（标已读钟）是同一族判断，都是人的动作。',
  cancelQuestion: NOT_FOR_MODEL + '取消挂起的问题：与作答同一族——它替人撤回一句已经说出口的话，人做得到不等于该交给模型。',
}

/**
 * Model-reachable actions that have NO execution path yet — the SECOND
 * direction, and the one the first gate cannot see.
 *
 * The first gate asks "did the UI grow something the model was never told
 * about". This one asks the opposite: "the model was told, and it still cannot
 * do it". A model learns from the catalog, so an action listed there with no
 * line of code behind it is a promise the tool will break at the moment
 * somebody tries it — and a model that has been told it can do something will
 * try.
 *
 * HOW "EXISTS" IS DECIDED, and why it is this crude: the gate reads the agent
 * tool's `case '<id>':` literals. That is deliberately literal — it asks "is
 * there a line of code that handles this id", not "is there probably a handler
 * somewhere". A cleverer inference would be a second opinion about intent, and
 * a second opinion is exactly the kind of thing that stays green forever.
 *
 * The marker is its own word, deliberately NOT `DEBT:`. That one means "we
 * forgot to put this action in the catalog"; this one means "it IS in the
 * catalog and the host has not wired it yet". Same direction of debt, opposite
 * ends of the pipeline, and merging the two counts would hide both.
 *
 * The table is meant to SHRINK. A paid entry is a finding, not a silent pass:
 * that is the difference between a ledger and a permanent allow-list, which is
 * what a table nobody has to prune inevitably becomes.
 */
const NO_EXECUTION = 'NO-EXECUTION: '
const PENDING_EXECUTION = {
  'task.duplicate': NO_EXECUTION + '目录已承诺模型能复制一张卡，host 的执行路径还没接上',
  'task.run': NO_EXECUTION + '目录已承诺模型能触发一次执行，host 的执行路径还没接上',
  'task.comment': NO_EXECUTION + '目录已承诺模型能对某个会话发言，host 的执行路径还没接上',
  'task.cancelComment': NO_EXECUTION + '目录已承诺模型能撤掉排队的评论轮次，host 的执行路径还没接上',
  'board.cruise': NO_EXECUTION + '目录已承诺模型能开关巡航与并发上限，host 的执行路径还没接上',
  'rule.create': NO_EXECUTION + '目录已承诺模型能建会话规则，host 的执行路径还没接上',
  'rule.update': NO_EXECUTION + '目录已承诺模型能改会话规则，host 的执行路径还没接上',
  'rule.delete': NO_EXECUTION + '目录已承诺模型能删会话规则，host 的执行路径还没接上',
  'session.create': NO_EXECUTION + '目录已承诺模型能按运行配置新建会话，host 的执行路径还没接上',
  'session.bind': NO_EXECUTION + '目录已承诺模型能挂来源会话/工作区，host 的执行路径还没接上',
  'session.rename': NO_EXECUTION + '目录已承诺模型能给会话改名，host 的执行路径还没接上',
  'session.reorder': NO_EXECUTION + '目录已承诺模型能调会话列顺序，host 的执行路径还没接上',
  'preset.create': NO_EXECUTION + '目录已承诺模型能存预设，host 的执行路径还没接上',
  'preset.update': NO_EXECUTION + '目录已承诺模型能改预设或设默认，host 的执行路径还没接上',
  'preset.delete': NO_EXECUTION + '目录已承诺模型能删预设，host 的执行路径还没接上',
}

/** Scan roots: the UI half plus the controller, because the controller calls
 *  its own public methods too and a verb reachable only from in there is still
 *  a verb the model was never told about. */
const SCAN_ROOTS = ['src/client', 'src/core/controller.ts']

const failures = []
const notes = []

const fail = message => failures.push(message)

/** The verdict a reason carries, or undefined for a plain non-action. */
const markerOf = reason => [DEBT, NOT_FOR_MODEL].find(marker => reason.startsWith(marker))

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

/** Every action id the agent tool has a `case` for — the execution paths that
 *  really exist. Literal on purpose (see {@link PENDING_EXECUTION}). */
function executedActionIds(toolsSource) {
  if (toolsSource.trim() === '') return null
  return new Set([...toolsSource.matchAll(/case\s+'([a-z]+\.[A-Za-z]+)'\s*:/g)].map(m => m[1]))
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
  const pendingExecution = input.pendingExecution ?? PENDING_EXECUTION

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
    } else if (markerOf(reason) !== undefined && reason.slice(markerOf(reason).length).trim() === '') {
      // A bare marker is the worst case of all: it asserts a verdict while
      // saying nothing, so it reads as a decision but documents no decision.
      const kind = markerOf(reason) === DEBT ? 'DEBT' : 'NOT-FOR-THE-MODEL'
      fail(`INTERNAL.${site.method} is marked "${kind}" with no reason after the marker — the marker is the verdict, the sentence after it is the decision; a bare one says "we decided" without saying what was decided`)
    } else if (reason.includes('NOT-FOR-THE-MODEL') && markerOf(reason) === undefined) {
      // Matched on the bare word, not the marker with its colon and space: the
      // mistake being caught is a verdict written into prose, and prose rarely
      // reproduces the punctuation.
      fail(`INTERNAL.${site.method} mentions NOT-FOR-THE-MODEL in the middle of its reason but does not START with the marker — the prefix is what the counts read, so an unmarked mention counts as a plain non-action`)
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

  // 1b. the OTHER direction: model -> execution. The gate above asks whether the
  // UI grew something the catalog does not mention; this one asks whether the
  // catalog promises the model something no line of code performs.
  const executed = executedActionIds(input.agentToolsText ?? '')
  if (executed === null) {
    fail('cannot read the agent tool source — src/host/agent/tools.ts was empty or missing, so every "the model can do it" check below would have passed on an empty input. This is a FINDING, not a skip')
    return failures.slice()
  }
  const modelReachable = catalog.actions.filter(a => a.surface !== 'ui').map(a => a.id)
  const unexecuted = []
  for (const id of modelReachable) {
    if (executed.has(id)) continue
    unexecuted.push(id)
    // A missing execution path is a FINDING whether or not the debt is written
    // down. Logging it is not a waiver: the model was told it can do this, and
    // it will try. The table exists to name the debt and count it, not to make
    // it stop being a defect.
    const logged = pendingExecution[id]
    const tail = logged === undefined
      ? 'and it is not recorded as a debt — record it in PENDING_EXECUTION with a reason, or implement it'
      : `logged debt: ${logged.slice(NO_EXECUTION.length)}`
    fail(`${id}: the catalog tells the model it can do this (surface "${catalog.actions.find(a => a.id === id).surface}"), but no \`case '${id}':\` exists in the agent tool — the model will try it and hit the "not wired to an execution path yet" branch. ${tail}`)
  }
  // The table is a ledger, not an allow-list: a paid entry must be deleted, and
  // an entry for an id the model cannot reach is a stale line either way.
  for (const [id, reason] of Object.entries(pendingExecution)) {
    if (executed.has(id)) {
      fail(`PENDING_EXECUTION["${id}"] is paid — the agent tool now has \`case '${id}':\`. Delete the entry; a table nobody prunes is indistinguishable from an allow-list, which is the thing this gate exists to prevent`)
    } else if (!modelReachable.includes(id)) {
      fail(`PENDING_EXECUTION["${id}"] names an action the catalog does not offer the model (either it is not in the catalog or its surface is 'ui') — the entry can never be earned, so it is a line that reads like a debt and is not one`)
    }
    if (reason.trim() === NO_EXECUTION.trim()) {
      fail(`PENDING_EXECUTION["${id}"] carries no reason after the marker — the marker is the verdict, the sentence after it is the debt; a bare one records a debt without saying what is owed`)
    } else if (!reason.startsWith(NO_EXECUTION)) {
      fail(`PENDING_EXECUTION["${id}"] does not start with "${NO_EXECUTION}" — this table is its own verdict and must not be confused with the catalog debt, which is the opposite end of the pipeline`)
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

  const paramCount = catalog.actions.reduce((sum, a) => sum + a.params.length, 0)
  // The two marked groups, counted and named SEPARATELY. Summing them would
  // make a deliberate product call indistinguishable from an oversight, and
  // "we decided that" is exactly the verdict that must never read as "we
  // forgot" — the difference decides whether the fix is to add a row or to
  // change nothing.
  const debt = Object.entries(internal).filter(([, reason]) => reason.startsWith(DEBT)).map(([m]) => m)
  const notForModel = Object.entries(internal).filter(([, reason]) => reason.startsWith(NOT_FOR_MODEL)).map(([m]) => m)
  const plain = Object.keys(internal).length - debt.length - notForModel.length
  notes.push(`catalog: ${catalog.actions.length} actions, ${catalog.verbs.length} verbs, ${paramCount} parameters read, ${publicMethods.length} public controller methods`)
  notes.push(`coverage: ${used.size} controller method(s) called across ${input.scanFiles.length} file(s); ${claimedBy.size} bound to a catalog action, ${plain} plain non-action(s) (reads, view switches, wiring)`)
  notes.push(`decided not-for-the-model: ${notForModel.length} real action(s) deliberately kept out of the catalog — a product decision, NOT an omission: ${notForModel.join(', ') || 'none'}`)
  notes.push(`catalog debt: ${debt.length} real action(s) the catalog does not carry yet — FORGOTTEN, and the fix is to add the row: ${debt.join(', ') || 'none'}`)
  notes.push(`model -> execution: ${modelReachable.length} action(s) the catalog offers the model, ${modelReachable.length - unexecuted.length} with a \`case\` in the agent tool, ${unexecuted.length} without one`)
  notes.push(`no-execution debt: ${unexecuted.length} action(s) the model is told about that the tool does not perform yet — a host-side wiring debt, NOT a missing catalog row; ${unexecuted.filter(id => pendingExecution[id] !== undefined).length} of them recorded in the ledger: ${unexecuted.join(', ') || 'none'}`)
  notes.push(`semantic: ${catalog.actions.filter(a => a.semantic).length} semantic action(s) checked against ${input.coreExportNames.length} core export(s)`)
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
    agentToolsText: existsSync(at('src', 'host', 'agent', 'tools.ts')) ? read('src/host/agent/tools.ts') : '',
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
