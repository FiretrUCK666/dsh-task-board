/**
 * The workbench's ONE check-for-updates controller.
 *
 * WHY THIS IS NOT PAGE STATE. The bar is shared by three pages, and the reader's
 * rule is that 「检查更新」 sits in the same place on all of them — so the state
 * behind it cannot belong to whichever page happens to be mounted. A panel
 * unmounts every time the reader switches to a conversation, and page-owned
 * state would throw away a check that is still running (or a dialog the reader
 * left open) for no reason they could see.
 *
 * So it is a module singleton, the same shape as `workbenchStage`: one place
 * that knows what the last answer was, and every bar reads it.
 *
 * WHY THE PANEL DOES NOT PASS A CLIENT. `update-source.ts` is already the
 * browser's whole face on the host route (bounded fetches, every failure
 * degrading to `undefined`). A seam for tests would be a second way in; the
 * spec exercises the same functions the panel calls.
 */
import type { UpdateApplyResult, UpdateSourceView } from '../update-source.ts'
import { requestUpdateApply, BUNDLED_VERSION, fetchUpdateSource } from '../update-source.ts'
import { isGitBehind, isNewerVersion } from '../../core/update-check.ts'

/** What pressing the button last did. */
export type UpdatePhase = 'idle' | 'checking' | 'latest' | 'available' | 'undetermined' | 'failed'

/** What the applied update last did. */
export interface UpdateApplyState {
  readonly phase: 'idle' | 'running' | 'done' | 'unchanged' | 'failed'
  readonly result?: UpdateApplyResult
}

/** Everything a surface may read. */
export interface UpdateState {
  readonly phase: UpdatePhase
  readonly source: UpdateSourceView | undefined
  readonly apply: UpdateApplyState
  /** Whether the result dialog is open. */
  readonly open: boolean
  /** Whether the copyable command was just copied (a 1.5s flash). */
  readonly copied: boolean
  /** Whether that copy attempt failed. */
  readonly copyFailed: boolean
}

/** Listeners re-render their own subtree; there is no polling. */
type Listener = () => void

/**
 * The controller. One instance, exported below.
 *
 * Reads are cheap and synchronous (`state()`), which is what a bar needs during
 * render. Writes notify every listener once, so all three bars stay in step.
 *
 * ── THE READ MUST BE IDENTITY-STABLE ────────────────────────────────────────
 *
 * `useSyncExternalStore` compares the snapshot it just read with the previous
 * one by REFERENCE. A `state()` that built a fresh object on every call would
 * look changed forever, so React would re-render, read again, see "changed"
 * again — and hit its update-depth limit. That is not a hypothetical: this
 * controller shipped that bug for one round and 151 tests went red with
 * 「Maximum update depth exceeded」.
 *
 * So `state` is a FIELD, not a builder: it is replaced only inside `emit()`,
 * which is called exactly once per change. Readers get the same object until
 * something actually changes.
 */
export class UpdateController {
  private phase: UpdatePhase = 'idle'
  private source: UpdateSourceView | undefined
  private apply: UpdateApplyState = { phase: 'idle' }
  private open = false
  private copied = false
  private copyFailed = false
  private readonly listeners = new Set<Listener>()
  private timer: ReturnType<typeof setTimeout> | undefined
  /** The identity-stable snapshot (see the class doc). */
  private snapshot: UpdateState = {
    phase: 'idle',
    source: undefined,
    apply: { phase: 'idle' },
    open: false,
    copied: false,
    copyFailed: false,
  }

  /**
   * Subscribe to changes.
   * @param listener - called once per change; must be cheap.
   * @returns the unsubscribe function (call it from the effect's cleanup).
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The current reading, for `useSyncExternalStore`. Same object until a change. */
  state = (): UpdateState => this.snapshot

  /** Everything derived from `source`, computed once per read. */
  derived(): UpdateDerived {
    return deriveOf(this.source)
  }

  /**
   * Private: publish one new snapshot, then notify.
   *
   * The snapshot is rebuilt HERE and nowhere else, so its identity changes
   * exactly when something changed — which is the whole contract the hook needs.
   */
  private emit(): void {
    this.snapshot = {
      phase: this.phase,
      source: this.source,
      apply: this.apply,
      open: this.open,
      copied: this.copied,
      copyFailed: this.copyFailed,
    }
    for (const listener of this.listeners) listener()
  }

  /** Clear the one-shot timer (idempotent). */
  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /**
   * Return to the resting state: no source, no dialog, no result, no timer.
   *
   * WHY THIS EXISTS IN THE PRODUCT AND NOT ONLY IN TESTS. The controller is a
   * singleton, so its state outlives any one panel — that is the point (a check
   * must survive a page switch). But a singleton also means STATE LEAKS BETWEEN
   * SCENARIOS: one test that opens the dialog leaves it open for the next, and
   * the second test then measures a screen it never asked for. A reset that the
   * tests can call is also the honest way for the product to say "forget the
   * last answer" — e.g. after a live reload swaps the bundle.
   */
  reset(): void {
    this.clearTimer()
    this.phase = 'idle'
    this.source = undefined
    this.apply = { phase: 'idle' }
    this.open = false
    this.copied = false
    this.copyFailed = false
    this.emit()
  }

  /** Private: the "attention borrowed for 2.5s, then back to rest" grammar. */
  private restAfter(phase: UpdatePhase): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.phase = 'idle'
      this.emit()
    }, 2500)
    this.phase = phase
  }

  /**
   * Ask the host once: which copy is running, where, what is newest, and how it
   * updates. One round trip answers all four (see `update-source.ts`).
   *
   * The newest-version answer comes from the host on purpose: it knows which
   * registry this profile uses, so a reader behind a mirror gets an answer, and
   * a git install gets a comparison at all.
   */
  check(): void {
    if (this.phase === 'checking') return
    this.clearTimer()
    this.phase = 'checking'
    /* **新一轮检查就是新的一轮，上一次的应用结果必须清掉。**
     *
     * `apply` 记的是「上一次按了更新之后发生了什么」，而它有三个终态
     * （`done` / `unchanged` / `failed`）。「一键更新」那颗按钮在其中两个里会消失——
     * 那是对的：一次动作已经走完，没有可再按的东西。但如果**不清它**，读者按下
     * 「检查更新」再查一次之后，那颗按钮仍然不会回来，因为 `apply.phase` 还停在上一轮
     * 的结论上。屏上于是出现一个「有一个更新可以装，但没有按钮」的对话框，而读者唯一
     * 的出路只剩下面那条终端命令。
     *
     * 清在这里而不是在 `run()` 里：会走到这条路的不是「又要跑一次」那个动作，是
     * 「重新看一遍现在是什么情况」——而它才是读者会反复走的那条。 */
    this.apply = { phase: 'idle' }
    this.emit()
    void (async () => {
      const source = await fetchUpdateSource()
      this.source = source
      if (source === undefined) {
        this.phase = 'failed'
        this.emit()
        return
      }
      const latestVersion = source.latest?.version
      const newer = latestVersion !== undefined && isNewerVersion(latestVersion, source.version)
      const gitNewer = source.mode === 'local' && source.git !== undefined && isGitBehind(source.git)
      // A git install has no comparable version baseline — the remote branch IS
      // its newest — so the dialog opens either way: that install's only update
      // path is this button.
      if (newer || gitNewer || source.mode === 'github') {
        this.phase = 'available'
        this.open = true
        this.emit()
        return
      }
      /* ── 「已是最新」必须是一个**有证据的**结论 ──────────────────────────────
       *
       * 这个按钮只有三种可能的脸：有新版 / 无法确认 / 已是最新。前两个都无害，
       * 第三个是这里唯一会说谎的那个——它断言了一件读者**无法核实**的事，而且顺手
       * 关掉了对话框（连同更新命令）。
       *
       * 所以判据不是「装法是哪一种」，而是**「我们手上有没有能得出结论的证据」**。
       * 枚举装法是错的方向：每多一种装法、每多一处降级，枚举就漏一次，而漏的那次
       * 表现正是这句话。这里只问：这两个可能的新版来源里，**哪一个真的读到了？**
       *
       *   · 发布号（`latest`）：npm / github / unknown 的答案来源。读不到 = 没证据。
       *     注意 `unknown` 也会去问（`readLatest` 只对 `local` 提前返回），别以为它
       *     一定没有答案。
       *   · 远端分支（`git.remoteHead`）：checkout 的答案来源。**只有 `git` 存在还不够**
       *     ——`readGitStatus` 在 `ls-remote` 超时/失败时仍然返回状态（head 读到了、
       *     remoteHead 缺失），那时它并不知道远端有没有新提交。`isGitBehind` 对这种
       *     情况返回 false，于是一个被墙的 github 会被念成「已是最新」——这恰好是
       *     那个 6 秒预算想要优雅降级掉的情形。
       */
      const hasPublishedAnswer = source.latest !== undefined
      const hasRemoteAnswer = source.mode === 'local'
        && source.git !== undefined
        && source.git.remoteHead !== undefined
      const cannotTell = source.mode === 'local' ? !hasRemoteAnswer : !hasPublishedAnswer
      if (cannotTell) {
        this.phase = 'undetermined'
        this.open = true
        this.emit()
        return
      }
      // Up to date — and only now is that a claim the host actually answered.
      this.restAfter('latest')
      this.emit()
    })()
  }

  /** Show or hide the result dialog. */
  setOpen(open: boolean): void {
    this.open = open
    this.emit()
  }

  /**
   * Copy the update command. Best-effort: a blocked clipboard reads as a failed
   * copy, never as a thrown error, and the flash is a 1.5s one-shot.
   * @param command - the line the dialog displays.
   */
  copyCommand(command: string): void {
    const flash = (ok: boolean): void => {
      this.copied = ok
      this.copyFailed = !ok
      this.emit()
      this.clearTimer()
      this.timer = setTimeout(() => {
        this.copied = false
        this.copyFailed = false
        this.emit()
      }, 1500)
    }
    void navigator.clipboard?.writeText(command).then(
      () => { flash(true) },
      () => { flash(false) },
    )
  }

  /**
   * Press "update": the host applies the plan it derived itself, and the source
   * is re-read afterwards.
   *
   * The re-read is REQUIRED, not defensive: a live reload can swallow the
   * answer, and "the host's version moved" is itself proof the update landed —
   * without it a successful update gets reported as a failure.
   */
  run(): void {
    if (this.apply.phase === 'running') return
    const before = this.source?.version ?? BUNDLED_VERSION
    this.apply = { phase: 'running' }
    this.emit()
    void (async () => {
      const result = await requestUpdateApply()
      const source = await fetchUpdateSource()
      if (source !== undefined) this.source = source
      const reported = result !== undefined && result.ok === true ? result : undefined
      const updated = reported !== undefined && reported.outcome !== 'unchanged'
      const landed = source !== undefined && source.version !== before
      if (updated || landed) {
        this.apply = {
          phase: 'done',
          result: updated && reported !== undefined
            ? reported
            : { ok: true, outcome: 'applied', version: source?.version ?? before },
        }
        this.restAfter('latest')
        this.emit()
        return
      }
      // Ran, version unchanged: neither success nor failure. The button stays —
      // the protection window may have been the blocker, and 「已更新到 v」 is a
      // sentence the reader cannot check.
      if (reported !== undefined) {
        this.apply = { phase: 'unchanged', result: reported }
        this.emit()
        return
      }
      this.apply = { phase: 'failed', ...(result !== undefined ? { result } : {}) }
      this.emit()
    })()
  }
}

/** The readings a dialog needs, derived once from one source view. */
export interface UpdateDerived {
  /** The running copy's version. */
  readonly current: string
  /** The newest upstream, when the host could read one. */
  readonly latest: UpdateSourceView['latest']
  /** Whether `latest` is newer than `current`. */
  readonly newer: boolean
  /** Local-checkout git state (only for `local` installs). */
  readonly git: UpdateSourceView['git']
  /** Whether that checkout is behind its remote. */
  readonly gitBehind: boolean
  /** How to update this copy, and who applies it. Absent before the first check. */
  readonly plan: UpdateSourceView['plan'] | undefined
}

/**
 * Derive the dialog's readings from one source view.
 * @param source - the last source view, or undefined before the first check.
 * @returns the readings; every field has a defined "unknown" value.
 */
export function deriveOf(source: UpdateSourceView | undefined): UpdateDerived {
  const current = source?.version ?? BUNDLED_VERSION
  const latest = source?.latest
  const newer = latest !== undefined && isNewerVersion(latest.version, current)
  const git = source?.mode === 'local' ? source.git : undefined
  const gitBehind = git !== undefined && isGitBehind(git)
  return { current, latest, newer, git, gitBehind, plan: source?.plan }
}

/** THE single controller, exported so every page's bar reads THIS one. */
export const updateController = new UpdateController()
