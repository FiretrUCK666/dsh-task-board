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
  // The shared test, stated ONCE so the rows below do not repeat it: calling one
  // of these twice with the same arguments leaves every document and the host
  // exactly where it was. That is what makes it a read. **A new read goes here;
  // the moment one of them starts changing a document, it stops being a read and
  // must become a catalog action** — that is the only way a row leaves this list.
  getSnapshot: '整份看板快照（含卡片、巡航、待审核数）',
  linkedOf: '这张卡挂了哪些会话、会话行长什么样',
  sessionsOf: '这张卡的会话列表（数量与归属）',
  sessionTitle: '会话的显示名；缺失时返回 undefined，不是空串',
  sessionInfo: '会话的静态信息（工作区、模型、创建时间）',
  sessionConfig: '会话**此刻**的配置（活投影：只读会一直拿到最新值，不带任何历史拷贝）',
  sessionLabelsOf: '会话的工作区归属标签（面板上那些胶囊）',
  sessionActiveOf: '会话是否还在工作（活性层：会话自己或它召唤的后代有轮次在跑）',
  liveStateOf: '这张卡此刻的活性判决（三值，panel 只在明确 `running` 时显示进行中，看不见的 `unknown` 不写成在跑）。任务清单的「在不在跑」只从这里取——同一个问题只许有一个答案。',
  sessionAvailability: '会话是否可用。**这是「不可用」的唯一判据**（归档、已删除都走它），别处不要另写一套',
  pendingInteractionOf: '会话上挂着的交互（审批 / 计划确认 / 提问）。**读它不是动作，作答才是**——作答是人的动作，在下面「决定不给模型」那一组里',
  questionPendingOf: '这条会话待作答的问题。读可以，作答与取消同样在下面「决定不给模型」那一组',
  relatedSessionIdSet: '与这张卡相关的会话集合（绑定 + 有轮次 + 工作区当前成员，减去已删除）',
  externalKindOf: '这条 id 是不是从侧栏拖进来的外源（外源的标题可以不在卡里）',
  boundSourceTitleOf: '绑定的来源（会话或工作区）显示成什么标题',
  offerableSessionGroups: '还能加进这张卡的会话，按工作区分组（已归档的已排除）',
  goalVerbs: '目标相关的动词，直接取自原生外壳——看板不拥有它们，所以也不可能有对应的动作',
  listTemplates: '存过的模板有哪些（名字与类别），不返回模板内容',
  presetStore: '排期预设库（新建任务时的 cron 候选）',
  runPresetStore: '运行配置预设库（含哪个是默认）',
  runCatalog: '斜杠命令目录（候选与描述），不发送任何命令',
  referenceSources: '可用的 `@` 引用来源表（文件、文件夹、会话）',
  referenceSessionOf: '这张卡在正文里引用的是哪条会话',
  referenceSessionCatalog: '引用会话的候选目录',
  loadTranscript: '读会话尾部这一段历史。**读历史不是动作**；往会话里发话才是（在目录里）',
  loadTranscriptPage: '再往早读一页会话。同上，纯读；翻页按钮在界面上，不构成一个动作',
  loadImage: '读一张图片的字节。读可以，**上传没有模型通道**（见下面「决定不给模型」那一组）',
  canRecheckSeat: '现在能不能重查更新席位。它只回答「能不能」，**真的去查那一下是人的动作**（见下面「决定不给模型」那一组）',
  // --- subscriptions and lifecycle: wiring, not verbs -------------------------
  // Held by an effect, torn down with it. Nothing here is something a person or a
  // model can ask for; they return an unsubscribe function and that IS the work.
  subscribe: '订阅快照变化（返回退订函数）',
  subscribeQuestions: '订阅待答问题变化（返回退订函数）',
  subscribeGoalActivation: '订阅目标上膛/解甲（返回退订函数）',
  start: '生命周期：装配时由 `ctx.effect` 调一次',
  dispose: '生命周期：effect 清理时释放订阅、定时器与 SSE',
  // --- sync and engine plumbing: nobody clicks these --------------------------
  // Called by the sync engine, the scheduler or a timer — never by a person and
  // never by the tool. A future one of these that DID become user-reachable
  // leaves this list the same way a read does: it becomes an action.
  applyRemote: '并入远端写入。**并进来之后永不回写**——这是多端同步的不变量，别为了「补齐」加回写',
  setHostProto: '协商 host 协议代次（同步客户端在租约应答里拿到）',
  setHostBoot: '记录 host 进程的启动时刻（用于「服务端未重启」提示）',
  setEngine: '记录本机是否持有引擎席位（席位是排他的，写入前先读）',
  applyScheduleNextRun: '调度器回报：给排期盖上下一跳的时间戳',
  setSchedulerHeartbeat: '调度器回报心跳时刻',
  setSchedulerSkips: '调度器回报被跳过的档期统计',
  tickCruise: '定时器驱动：巡航窗口到点的开关与派发',
  tickSessionRules: '定时器驱动：会话规则的到点检查',
  fireLoopRule: '定时器驱动：on-complete 续跑。**界面上没有对应按钮**（自动化自己续自己）',
  fireOnCompleteRules: '定时器驱动：一轮跑完后的规则触发。界面上同样没有按钮',
  sendSessionMessage: '底层投递：评论与会话规则共用它。上层动作在目录里，**这一层不是**',
  recordNativeTurn: '观测记账：原生侧那边跑完一轮。不是人点的动作，所以不在目录里',
  recordActivityWake: '观测记账：原生侧活动唤醒。触发者是原生侧，不是人',
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
 *
 * ── A `case` THAT ONLY REFUSES IS NOT AN EXECUTION PATH ─────────────────────
 * This gate counts a `case` as the action being executable, and that judgment
 * is right — but it is easy to fool from the other side. Three engine actions
 * each got a `case` whose entire body was a refusal, and the gate promptly
 * reported their debt as PAID while the actions were still unusable. A refusal
 * is a third kind of line, and it was a duplicate one: the fall-through already
 * refuses everything the relay does not carry, so those cases said the same
 * thing twice — and the duplicate is what the gate misread as progress.
 *
 * So before writing a `case`, ask what that line actually DOES: a document
 * change, a relay, or a refusal? **Only the first two are a `case`; the refusal
 * belongs to the fall-through.** The judgment was NOT changed to suit that
 * incident — "is there a line of code deciding how this action goes" is the
 * right question, and a case that only says no does not answer it. It simply
 * should not have been written.
 */
const NO_EXECUTION = 'NO-EXECUTION: '
const PENDING_EXECUTION = {
  'task.comment': NO_EXECUTION + 'host 侧的执行路径还没接上；这条动作的效果不是一次运行，工具不会把它转发给引擎',
  'session.create': NO_EXECUTION + 'host 侧的执行路径还没接上；这条动作的效果不是一次运行，工具不会把它转发给引擎',
  'session.rename': NO_EXECUTION + 'host 侧的执行路径还没接上；这条动作的效果不是一次运行，工具不会把它转发给引擎',
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
    const lane = /^\s{4}lane:\s*'([^']*)'/m.exec(block)
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
            boolean: /\bboolean:\s*true\b/.test(spec),
            hasRange: /\brange:\s*\{/.test(spec),
            hasObject: /\bobject:\s*\[/.test(spec),
            hasList: /\blist:\s*(?:'|object|\{)/.test(spec),
            oneOf: oneOfValues(spec),
            default: /\bdefault:\s*'([^']*)'/.exec(spec)?.[1],
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
      lane: lane === null ? undefined : lane[1],
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

/** The string values of a `oneOf`, or undefined when the param declares none.
 *  The array can be a reference (`oneOf: MOVABLE`) rather than a literal, and
 *  that counts as "declared a closed set" — the fake-boolean check only needs
 *  to see the two boolean spellings when they are written out. */
function oneOfValues(spec) {
  const at = /\boneOf:\s*\[([^\]]*)\]/.exec(spec)
  if (at === null) return undefined
  return [...at[1].matchAll(/'([^']*)'/g)].map(m => m[1])
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
 * The engine-relay branch — the one place an action that is NOT a run can be
 * silently forwarded as one. Returns the slice, or null if it cannot be found
 * (which is a finding, never a skip).
 */
function engineBranch(toolsSource) {
  const at = toolsSource.search(/lane\s*===\s*'engine'/)
  if (at === -1) return null
  const after = toolsSource.indexOf("lane === 'document'", at)
  const end = after === -1 ? Math.min(toolsSource.length, at + 2000) : after
  return toolsSource.slice(at, end)
}

/**
 * Two things this gate KNOWS IT CANNOT CHECK, and why. Both were looked for
 * and both are real gaps; neither has a field-level detector, and inventing one
 * that guesses at prose would be worse than the gap (a gate that reports a
 * confident wrong answer is how a correct catalog loses its protection).
 *
 * ── 1. "SUMMARY PROMISES SOMETHING THE PARAMS CANNOT DELIVER" ────────────────
 * The real instance: `task.schedule` said 「上/解排期」 while `enabled` was
 * optional with no stated absent case, so the model could not tell what omitting
 * it meant. The machine-readable half of that promise is the `default` field,
 * and 3c/3d above now police it. The prose half cannot be policed: deciding
 * that a sentence "promises a switch" means deciding what a switch is, in a
 * language this script does not parse. What would make it gateable: a declared
 * field that carries the promise instead of the sentence — e.g. a
 * `capabilities: string[]` the renderer prints, so the promise has a shape.
 *
 * ── 2. VERB SEMANTIC OVERLAP (`update` covering four kinds of change,
 *        `create` quietly containing `bind`, `move` quietly also marking read)
 *        ────────────────────────────────────────────────────────────────────
 * `semantic: true` already means "this action means more than its field writes,
 * and the UI and the tool must share one implementation", and the semanticOf
 * check above holds that to a real exported function. But the overlap INSIDE a
 * verb family has no field at all: `task.approve` is a move that also marks
 * read, and the ONLY place that says so is its `summary` ("动词是 move，但读
 * 状态也一起变了"). Rewrite that sentence and nothing here rings — there is
 * nothing left to read. What would make it gateable: a declared field such as
 * `alsoDoes?: string[]` naming the extra effect, at which point the check is
 * one line and the summary becomes a human convenience rather than the only
 * authority. Until then: **this is disambiguated by prose, and prose is not
 * checkable.**
 */

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
  // 3. parameter declarations. Fields only: every one of these reads a DECLARED
  // shape, never a sentence's meaning. A gate that guesses at prose is how you
  // get a confident wrong answer with a green light.
  for (const action of catalog.actions) {
    const names = new Set(action.params.map(p => p.name))
    // 3b is a property of the ACTION, not of a parameter — running it inside
    // the per-param loop reported the same unsatisfiable set once per param.
    //
    // SCOPE, WRITTEN DOWN SO THE NEXT PERSON DOES NOT ASSUME MORE: this asks
    // "NOT ONE conditionally-required parameter here is discriminated". It is
    // NOT "every cluster of conditional parameters needs its own
    // discriminator". An action may legitimately mix two discriminated
    // families, and the stricter reading fires on exactly that case. Tightening
    // was considered and refused on purpose: a false positive gets the whole
    // gate switched off, while a miss only leaves it incomplete — and a gate
    // that is switched off protects nothing at all. Gap beats noise here.
    const conditional = action.params.filter(p => p.requiredWhen !== undefined)
    if (conditional.length >= 2) {
      const discriminated = conditional.some(c =>
        [...names].some(name => name !== c.name && new RegExp(`\\b${name}\\b`).test(c.requiredWhen)))
      if (!discriminated) {
        fail(`${action.id}: ${conditional.map(c => c.name).join(' and ')} are all conditionally required and no declared parameter discriminates between them — the caller has no way to say which condition holds, so the condition set is unsatisfiable. Add the parameter that chooses (e.g. a oneOf of what is being acted on) and name it in the conditions`)
      }
    }
    for (const param of action.params) {
      // 3a. A boolean spelled as two strings is a lie about the type: the host
      // reads the string (truthy, or refused) and the model reads an enum.
      for (const value of param.oneOf ?? []) {
        if (value === 'true' || value === 'false') {
          fail(`${action.id}.${param.name}: oneOf lists '${value}' — that is a boolean wearing an enum's clothes. Use \`boolean: true\`; a string here reaches the host as a string`)
        }
      }
      // 3c. A condition that names an OPTIONAL parameter whose "not given" case
      // is not the obvious one: omitting it silently means something the literal
      // reading does not say. `appliesWhen` gets the same treatment as
      // `requiredWhen` (3d) because it is the same field-level fact wearing a
      // different word: this parameter only means anything under a condition,
      // so its absent case is exactly as load-bearing.
      for (const name of names) {
        if (name === param.name) continue
        for (const [field, text] of [['requiredWhen', param.requiredWhen], ['appliesWhen', param.appliesWhen]]) {
          if (text === undefined || !new RegExp(`\\b${name}\\b`).test(text)) continue
          const named = action.params.find(p => p.name === name)
          if (named?.optional === true && named.default === undefined) {
            fail(`${action.id}.${param.name}: ${field} "${text}" — but ${name} is optional and has no \`default\`, so what omitting it means is unwritten. Say it in ${name}.default (the absent case can differ from the literal reading)`)
          }
        }
      }
    }
  }

  // 1c. the relay's own routing. An engine action that is not a run must never
  // be forwarded as one. The shape that caused the incident had no per-action
  // test at all — generalised on `lane`, so creating a session, renaming one
  // and speaking into one were all forwarded as "run this card" — and because
  // no `case` was missing, the execution gate above stayed green through it.
  // The fault was a WRONG DEFAULT, not a missing line.
  //
  // Two rules, both mechanical:
  //   1. the branch must test the action at all. No test = every engine action
  //      is relayed, which is the incident exactly.
  //   2. an engine action must not be RECOGNISED BY ITS NAME. A name is a line
  //      someone has to remember; the moment a new engine action appears and
  //      nobody adds the line, it is relayed as a run again. Keying the
  //      decision on a catalog field is what keeps the branch right on its own.
  // Both are findings: a name-keyed guard is safe TODAY (it refuses what it does
  // not name) but it is the shape that regrows the bug, and a guard that is
  // being moved to the structural form should be told so while it is still here.
  const engine = catalog.actions.filter(a => a.lane === 'engine').map(a => a.id)
  const branch = engineBranch(input.agentToolsText ?? '')
  if (branch === null) {
    fail('cannot find the engine lane branch in src/host/agent/tools.ts — the "route engine actions here" condition was not found, so the relay routing cannot be checked. This is a FINDING, not a skip')
  } else {
    // A per-action test, in either shape: a comparison against `id`, a switch on
    // it, a set membership test, OR a catalog lookup keyed by it. The last one
    // matters — `ACTIONS[id].verb !== 'run'` IS a per-action gate, and a check
    // that failed to see it would report the correct implementation as broken.
    const gated = /\bid\s*(?:!==|===)|switch\s*\(\s*id\s*\)|\.has\(\s*id\s*\)|ACTIONS\s*\[\s*id\s*\]/.test(branch)
    if (!gated) {
      for (const id of engine) {
        fail(`${id}: its lane is 'engine', and the relay branch has NO per-action test — every engine action is forwarded as "run this card", so anything that is not a run (a session, a rename, a message) is silently relayed as one. Add a per-action gate that refuses the ones the relay does not carry`)
      }
    }
    for (const id of engine) {
      if (new RegExp(`'${id}'`).test(branch)) {
        fail(`${id}: the relay branch recognises this engine action BY NAME ('${id}'). A name is a line someone has to remember — add an engine action, forget the line, and it is forwarded as a run again. Decide from a catalog field instead (the verb, or a lane the relay does not carry)`)
      }
    }
  }

  notes.push(`engine lane: ${engine.length} action(s) the catalog routes through the engine: ${engine.join(', ') || 'none'}`)

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
