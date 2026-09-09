/**
 * The board document: the ONE host-owned truth every browser replica syncs
 * against — the task ledger plus the board's shared state sections (cruise,
 * schedule presets, run presets) — and the merge grammar that makes
 * concurrent multi-device edits converge deterministically.
 *
 * Sync model (host = authority, browsers = optimistic replicas):
 * - A client commits its whole local view: the full tasks array, the section
 *   values, and the deletions it observed since its last synced baseline
 *   (each delete carries the `updatedAt` the client saw, so the host can tell
 *   a delete from a stale copy).
 * - The host resolves record by record — last-writer-wins on the record's own
 *   `updatedAt`, tombstones suppressing deletes that a stale replica would
 *   otherwise resurrect — and section by section (LWW on the section write
 *   stamp), then returns the authoritative document. Every replica converges
 *   on that response, so drift is impossible without compare-and-swap.
 * - `revision` is the host's monotonic change counter (the SSE resync signal
 *   and the "did anything actually move" test), never a write gate.
 *
 * Clock-skew rule: record conflicts are resolved by AUTHORSHIP, not by
 * clocks — a commit declares `changed` (the ids its own edits moved against
 * the last synced baseline), the host accepts those unconditionally (its
 * serial commit order decides, so a phone whose clock runs minutes behind
 * still wins with its newest gesture), and every record the replica does NOT
 * claim merges by `updatedAt` LWW (an untouched stale copy can never clobber
 * a newer edit). Tombstones are stamped one millisecond above the newest
 * `updatedAt` the host ever saw for that id, so a delete always beats the
 * stale copies other replicas still hold, while a genuinely newer edit (a
 * concurrent revive) still wins. `stamps` records the host wall time each
 * row was last accepted (diagnostics / future pruning).
 *
 * Framework-free pure logic: host and client share this one grammar; tests
 * drive it directly.
 */
import { isCruiseWindow, normalizeWindow, sortWindows } from './cruise.ts'
import type { CruiseWindow } from './cruise.ts'
import { normalizeRunPresetDocument } from './run-presets.ts'
import type { RunPresetsDocument } from './run-presets.ts'
import { parseLedger } from './store.ts'
import type { TaskRecord } from './tasks.ts'
import { parsePresets } from './presets.ts'
import type { SchedulePreset } from './presets.ts'

/** The cruise section value (structurally the controller's CruiseState). */
export interface CruiseValue {
  enabled: boolean
  manual?: boolean
  limit: number
  schedule: CruiseWindow[]
  /** Soft WIP awareness (advisory only, never blocks drags): absent = unlimited.
   *  Lives in the cruise section so no new sync section/route is needed —
   *  the existing section claim + LWW carries it, and old docs normalize to
   *  unlimited without migration. */
  wip?: WipLimits
}

/** Soft per-board WIP limits: each present number is an advisory ceiling. */
export interface WipLimits {
  /** Total cards in play (running + review); undefined = unlimited. */
  global?: number
  /** Cards in running; undefined = unlimited. */
  running?: number
}

/** One synced section: the value plus the client write stamp (LWW key). */
export interface BoardSection<T> {
  value: T
  at: number
}

/** The deletions a client observed since its baseline, with the stamp each
 *  delete was computed against. */
export interface BoardDelete {
  id: string
  baseUpdatedAt: number
}

/** One relayed user action: run this task with this trigger (the engine
 *  executes; a non-engine replica forwards the request through the host). */
export interface BoardCommand {
  type: 'run'
  taskId: string
  trigger: 'manual' | 'schedule' | 'chain'
  /** The replica the user acted on (informational; the engine executes). */
  clientId: string
}

/** Everything an SSE subscriber receives; plain JSON, one line per frame. */
export type BoardEvent =
  | { type: 'commit'; revision: number; clientId: string }
  | { type: 'lease'; holder: string | undefined; expiresAt: number | undefined }
  | { type: 'command'; command: BoardCommand }

/** The engine-lease state every board API call answers with. THE host's own
 *  production: `proto` and `bootedAt` are REQUIRED so no construction branch
 *  can ever ship a seat view that forgets them (the one hand-built literal
 *  that did is what made the "服务端未重启" banner lie forever). An answer
 *  arriving over the wire is the `LeaseWire` shape below instead. */
export interface LeaseState {
  held: boolean
  holder: string | undefined
  expiresAt: number | undefined
  /** The host's lease protocol version (2 = visibility preemption). Absent on
   *  the WIRE = a host older than the flag — replicas can then TELL the user
   *  the seat may be stuck on a background device instead of leaving it
   *  mysterious. */
  proto: number
  /** When the answering host process started serving the board. The stale-host
   *  dialog shows it, so "我明明重启了" is answered by a clock reading rather
   *  than by a guess (old process vs. a different instance behind the URL). */
  bootedAt: number
}

/** A lease answer from an untrusted host: only `held` is guaranteed (any
 *  field may be absent on an older deployment). */
export type LeaseWire = Partial<Omit<LeaseState, 'held'>> & Pick<LeaseState, 'held'>

/** One tombstone: the logical stamp a newer edit must beat, plus the host
 *  wall time it was written (pruning key). */
export interface Tombstone {
  at: number
  seenAt: number
}

/** The full authoritative document the host owns and persists. */
export interface BoardDoc {
  /** Host monotonic change counter. */
  revision: number
  /** The task ledger (normalized rows). */
  tasks: TaskRecord[]
  /** Auto-cruise state (shared: every replica sees the same switch/limit/windows). */
  cruise: BoardSection<CruiseValue>
  /** User schedule presets (the built-in list is never stored). */
  schedulePresets: BoardSection<SchedulePreset[]>
  /** Run-config presets document (custom rows + default id). */
  runPresets: BoardSection<RunPresetsDocument>
  /** taskId → tombstone; suppresses stale replicas resurrecting a delete. */
  tombstones: Record<string, Tombstone>
  /** taskId → host wall time the row was last accepted (diagnostics). */
  stamps: Record<string, number>
  /** When the host first created the document (migration probe). */
  bornAt: number
}

/** The three synced sections a commit can claim authorship of. */
export type BoardSectionKey = 'cruise' | 'schedulePresets' | 'runPresets'

/** What a client sends per commit: its full view, the ids its own edits
 *  moved since the last synced baseline (authorship claims), the sections it
 *  edited, and the deletions it observed. */
export interface BoardCommit {
  clientId: string
  tasks: readonly TaskRecord[]
  /** The records THIS replica changed against its baseline — the host takes
   *  these unconditionally (clock-independent); absence = untouched copy. */
  changed?: readonly string[]
  /** Sections THIS replica edited — accepted unconditionally and re-stamped
   *  with the host clock. An ABSENT array (a pre-claim client) falls back to
   *  section LWW; an empty array (a claim-protocol client) means "nothing to
   *  say about the sections" and skips them entirely — a stale baseline copy
   *  riding every commit can then never clobber a newer section write. */
  sectionClaims?: readonly BoardSectionKey[]
  deleted: readonly BoardDelete[]
  cruise: BoardSection<CruiseValue>
  schedulePresets: BoardSection<SchedulePreset[]>
  runPresets: BoardSection<RunPresetsDocument>
}

/** Tombstones older than this are pruned (a delete this old cannot still be
 *  contested by a realistic offline replica). */
export const TOMBSTONE_TTL_MS = 30 * 86_400_000

/** The default cruise section value of a never-written board. */
export const DEFAULT_CRUISE_VALUE: CruiseValue = { enabled: false, limit: 5, schedule: [] }

/** Concurrency budget bounds — THE one declaration (the controller clamps
 *  writes to the same pair; normalization clamps reads, so a remote commit
 *  can never inject an unbounded budget). */
export const CRUISE_LIMIT_MIN = 1
export const CRUISE_LIMIT_MAX = 20

/** Soft WIP bounds — THE one declaration (same clamp-everywhere discipline as
 *  the cruise budget; undefined = unlimited, so old docs stay valid). */
export const WIP_LIMIT_MIN = 1
export const WIP_LIMIT_MAX = 20

/** A fresh empty document (host first boot; revision 0 marks "never committed"). */
export function emptyBoardDoc(now: number): BoardDoc {
  return {
    revision: 0,
    tasks: [],
    cruise: { value: DEFAULT_CRUISE_VALUE, at: now },
    schedulePresets: { value: [], at: now },
    runPresets: { value: { presets: [] }, at: now },
    tombstones: {},
    stamps: {},
    bornAt: now,
  }
}

/** Normalize an unknown cruise value (the controller constructor's grammar,
 *  shared so host and client judge persisted cruise state identically). */
export function normalizeCruiseValue(value: unknown): CruiseValue {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_CRUISE_VALUE }
  const row = value as Record<string, unknown>
  const raw = typeof row.limit === 'number' && Number.isInteger(row.limit) ? row.limit : DEFAULT_CRUISE_VALUE.limit
  const limit = Math.min(CRUISE_LIMIT_MAX, Math.max(CRUISE_LIMIT_MIN, raw))
  const wip = normalizeWipLimits(row.wip)
  return {
    enabled: row.enabled === true,
    ...(row.manual === true || row.manual === false ? { manual: row.manual } : {}),
    limit,
    schedule: Array.isArray(row.schedule)
      ? sortWindows((row.schedule as unknown[]).filter(isCruiseWindow).map(normalizeWindow))
      : [],
    ...(wip !== undefined ? { wip } : {}),
  }
}

/** Normalize an unknown WIP value: undefined = unlimited (old docs); present
 *  numbers clamp to the WIP bounds; garbage drops to undefined (never throws,
 *  so a remote commit can never poison the section). */
export function normalizeWipLimits(value: unknown): WipLimits | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const cleanOne = (raw: unknown): number | undefined => {
    if (typeof raw !== 'number' || !Number.isInteger(raw)) return undefined
    return Math.min(WIP_LIMIT_MAX, Math.max(WIP_LIMIT_MIN, raw))
  }
  const global = cleanOne(row.global)
  const running = cleanOne(row.running)
  if (global === undefined && running === undefined) return undefined
  return {
    ...(global !== undefined ? { global } : {}),
    ...(running !== undefined ? { running } : {}),
  }
}

/** Whether a count exceeds an advisory limit (undefined limit = never over). */
export function isWipOver(count: number, limit: number | undefined): boolean {
  return limit !== undefined && count > limit
}

/** Normalize an unknown section carrying a value + write stamp. */
function normalizeSection<T>(value: unknown, at: number, fallback: T, clean: (raw: unknown) => T): BoardSection<T> {
  if (typeof value !== 'object' || value === null) return { value: fallback, at }
  const row = value as Record<string, unknown>
  const stamp = typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : at
  return { value: clean(row.value), at: stamp }
}

/** Normalize an unknown persisted document (the medium's word is data, not
 *  truth: every part degrades to its empty shape rather than failing the doc).
 *  @param value - the raw medium/global value.
 *  @param now - clock for the empty/fresh fallbacks (host passes its injected
 *    clock so a first-boot document carries a deterministic birth time). */
export function normalizeBoardDoc(value: unknown, now: number = Date.now()): BoardDoc {
  if (typeof value !== 'object' || value === null) return emptyBoardDoc(now)
  const row = value as Record<string, unknown>
  const revision = typeof row.revision === 'number' && Number.isFinite(row.revision) && row.revision >= 0 ? Math.floor(row.revision) : 0
  const bornAt = typeof row.bornAt === 'number' && Number.isFinite(row.bornAt) ? row.bornAt : now
  const tasks = Array.isArray(row.tasks) ? parseLedger(JSON.stringify(row.tasks)) : []
  const tombstones: Record<string, Tombstone> = {}
  if (typeof row.tombstones === 'object' && row.tombstones !== null) {
    for (const [id, entry] of Object.entries(row.tombstones as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) continue
      const t = entry as Record<string, unknown>
      if (typeof t.at !== 'number' || !Number.isFinite(t.at)) continue
      tombstones[id] = { at: t.at, seenAt: typeof t.seenAt === 'number' && Number.isFinite(t.seenAt) ? t.seenAt : bornAt }
    }
  }
  const empty = emptyBoardDoc(bornAt)
  const stamps: Record<string, number> = {}
  if (typeof row.stamps === 'object' && row.stamps !== null) {
    for (const [id, at] of Object.entries(row.stamps as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at) && at >= 0) stamps[id] = at
    }
  }
  return {
    revision,
    tasks,
    cruise: normalizeSection(row.cruise, empty.cruise.at, DEFAULT_CRUISE_VALUE, normalizeCruiseValue),
    schedulePresets: normalizeSection(row.schedulePresets, empty.schedulePresets.at, [], parsePresetsRaw),
    runPresets: normalizeSection(row.runPresets, empty.runPresets.at, { presets: [] }, normalizeRunPresetDocument),
    tombstones,
    stamps,
    bornAt,
  }
}

/** Presets arrive as a raw JSON array (the persisted shape); parsePresets
 *  works on the JSON text, so round-trip through it for one grammar. */
function parsePresetsRaw(raw: unknown): SchedulePreset[] {
  if (!Array.isArray(raw)) return []
  return parsePresets(JSON.stringify(raw))
}

/** The deletions between a synced baseline and the client's next array:
 *  ids the baseline had and the next view dropped (a locally created-then-
 *  deleted task never entered the baseline, so it produces no delete). */
export function diffDeletions(
  baseline: readonly TaskRecord[],
  next: readonly TaskRecord[],
): BoardDelete[] {
  const kept = new Set(next.map(task => task.id))
  const deleted: BoardDelete[] = []
  for (const task of baseline) {
    if (!kept.has(task.id)) deleted.push({ id: task.id, baseUpdatedAt: task.updatedAt })
  }
  return deleted
}

/**
 * The AUTHORSHIP set of a commit: ids whose CONTENT moved between the
 * baseline the replica synced and the view it now commits. An untouched
 * copy of a host row (same content, same serialization) is never claimed,
 * so the claim can only vouch for edits this replica genuinely made —
 * reorders, title changes, new tasks all count; a stale copy the replica
 * never touched does not.
 *
 * READ STATE IS NOT AUTHORSHIP: `viewedAt` (on the task and on its rounds)
 * is a pure "has the human seen this" bookkeeping field — opening a card is
 * not editing it. It is stripped before the comparison, so a viewedAt-only
 * flip never claims the row. Without this, a viewer whose commit rode a
 * baseline from BEFORE the engine recorded an external round would claim
 * authorship of the whole row and (claims win unconditionally, last-write-
 * wins by arrival) silently delete the engine's round and revert the card's
 * column — the exact "I opened the card and its 进行中 disappeared" machine.
 * Read-state writes still propagate: they simply merge under plain LWW.
 */
export function changedIdsOf(
  baseline: readonly TaskRecord[],
  next: readonly TaskRecord[],
): string[] {
  const before = new Map(baseline.map(task => [task.id, authorshipKey(task)]))
  const changed: string[] = []
  for (const task of next) {
    const previous = before.get(task.id)
    if (previous === undefined || previous !== authorshipKey(task)) changed.push(task.id)
  }
  return changed
}

/** One row's authorship fingerprint: its JSON minus every read-state field. */
function authorshipKey(task: TaskRecord): string {
  const { viewedAt: _taskViewed, ...rest } = task
  return JSON.stringify({
    ...rest,
    executions: task.executions.map(({ viewedAt: _roundViewed, ...round }) => round),
  })
}

/** The larger of two optional read stamps (undefined = never seen). */
function maxSeen(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return a >= b ? a : b
}

/**
 * Fold the incoming row's READ STATE into the content winner: task.viewedAt
 * and each execution's viewedAt move forward only (matched by round id; a
 * round the winner lacks keeps whatever the winner has). Returns the same
 * object when nothing moved (no churn, no broadcast).
 */
function mergeReadState(winner: TaskRecord, incoming: TaskRecord): TaskRecord {
  const viewedAt = maxSeen(winner.viewedAt, incoming.viewedAt)
  const rounds = winner.executions.map(round => {
    const seen = incoming.executions.find(candidate => candidate.id === round.id)
    const roundViewed = maxSeen(round.viewedAt, seen?.viewedAt)
    return roundViewed === round.viewedAt ? round : { ...round, viewedAt: roundViewed }
  })
  const viewMoved = viewedAt !== winner.viewedAt
  const roundsMoved = rounds.some((round, index) => round !== winner.executions[index])
  if (!viewMoved && !roundsMoved) return winner
  return { ...winner, viewedAt, executions: rounds }
}

/** Structural equality of two documents (the "did anything move" test that
 *  keeps a no-op commit from bumping the revision and storming replicas). */
export function sameBoardDocs(a: BoardDoc, b: BoardDoc): boolean {
  return JSON.stringify({ t: a.tasks, c: a.cruise, p: a.schedulePresets, r: a.runPresets, x: a.tombstones })
    === JSON.stringify({ t: b.tasks, c: b.cruise, p: b.schedulePresets, r: b.runPresets, x: b.tombstones })
}

/**
 * Apply one client commit to the authoritative document and return the new
 * truth (the input is never mutated). The merge is the whole sync contract:
 *
 * - put: a record the host lacks is inserted unless a tombstone outranks it
 *   (then the delete stands); a record the host has is replaced when the
 *   replica CLAIMS it (in `changed` — the commit arrived after whatever the
 *   host holds, host serialization decides, clocks are irrelevant; content-
 *   equal claims are no-ops) or, unclaimed, when the incoming copy is simply
 *   newer (`updatedAt` LWW, host wins ties). Every acceptance stamps the row
 *   with the host clock.
 * - delete: honored only when the host copy is not newer than the baseline
 *   stamp the delete was computed against; the tombstone lands one ms above
 *   the newest `updatedAt` ever seen for the id (skew-proof).
 * - sections: replaced when the incoming write stamp is >= the stored one
 *   (host order decides ties — the later commit wins, deterministically).
 * - unchanged result → the same document object (no revision bump, no
 *   persist, no broadcast).
 */
export function applyCommit(doc: BoardDoc, commit: BoardCommit, now: number): BoardDoc {
  const byId = new Map(doc.tasks.map(task => [task.id, task]))
  const tombstones = { ...doc.tombstones }
  const stamps = { ...doc.stamps }
  const result = new Map(byId)
  const claimed = new Set(commit.changed ?? [])

  // 1) puts — the client's full array (absence is NOT a delete; deletes are
  // the explicit list below, so remote rows the client never saw survive).
  for (const task of commit.tasks) {
    const incoming = normalizeIncomingTask(task)
    if (incoming === undefined) continue
    const host = result.get(incoming.id)
    if (host === undefined) {
      const tomb = tombstones[incoming.id]
      if (tomb !== undefined && incoming.updatedAt <= tomb.at) continue
      delete tombstones[incoming.id]
      result.set(incoming.id, incoming)
      stamps[incoming.id] = now
      continue
    }
    let winner: TaskRecord | undefined
    if (claimed.has(incoming.id)) {
      // The replica vouches for this content: accepted unconditionally
      // (host-serialized last-write-wins — the phone-clock class of bugs
      // cannot flip it). A content-equal claim is a no-op.
      if (authorshipKey(host) !== authorshipKey(incoming)) winner = incoming
    } else if (incoming.updatedAt > host.updatedAt) {
      winner = incoming
    }
    // READ STATE IS A MONOTONE JOIN, never a register: whichever row wins the
    // CONTENT, "has the human seen it" only ever moves forward — so a viewer
    // that merely opened a card propagates its viewedAt without ever being
    // able to clobber another replica's newer content.
    const merged = mergeReadState(winner ?? host, incoming)
    if (winner !== undefined) {
      result.set(incoming.id, merged)
      stamps[incoming.id] = now
    } else if (merged !== host) {
      result.set(incoming.id, merged)
    }
  }

  // 2) deletes — honored against the host copy's freshness.
  for (const del of commit.deleted) {
    const host = result.get(del.id)
    if (host === undefined) {
      // Already gone (another replica deleted it): keep the existing tombstone.
      continue
    }
    if (host.updatedAt > del.baseUpdatedAt) continue // edited after the client's baseline → the delete loses
    const newest = Math.max(host.updatedAt, ...commit.tasks.filter(task => task.id === del.id).map(task => task.updatedAt), 0)
    result.delete(del.id)
    delete stamps[del.id]
    tombstones[del.id] = { at: newest + 1, seenAt: now }
  }

  // 3) prune ancient tombstones (and the host stamps of rows long gone).
  for (const [id, tomb] of Object.entries(tombstones)) {
    if (now - tomb.seenAt > TOMBSTONE_TTL_MS && !result.has(id)) delete tombstones[id]
  }
  for (const id of Object.keys(stamps)) {
    if (!result.has(id)) delete stamps[id]
  }

  const tasks = doc.tasks
    .filter(task => result.has(task.id))
    .map(task => result.get(task.id)!)
  // Host rows keep their order; client rows the host lacked append at the end
  // (their `order` field carries the real column position).
  const seen = new Set(doc.tasks.map(task => task.id))
  for (const task of commit.tasks) {
    const merged = result.get(task.id)
    if (merged !== undefined && !seen.has(task.id)) {
      tasks.push(merged)
      seen.add(task.id)
    }
  }

  const next: BoardDoc = {
    revision: doc.revision + 1,
    tasks,
    cruise: mergeSection(doc.cruise, commit.cruise, normalizeCruiseValue, 'cruise', now, commit.sectionClaims),
    schedulePresets: mergeSection(doc.schedulePresets, commit.schedulePresets, parsePresetsRaw, 'schedulePresets', now, commit.sectionClaims),
    runPresets: mergeSection(doc.runPresets, commit.runPresets, normalizeRunPresetDocument, 'runPresets', now, commit.sectionClaims),
    tombstones,
    stamps,
    bornAt: doc.bornAt,
  }
  return sameBoardDocs(doc, next) ? doc : { ...next, revision: doc.revision + 1 }
}

/**
 * Section merge. CLAIM protocol (a commit carrying `sectionClaims`): only a
 * claimed section is taken — unconditionally, re-stamped with the host clock
 * (client clocks never decide a section) — and an unclaimed section is
 * SKIPPED, so the baseline copy every commit rides can never clobber a newer
 * write. LEGACY (no `sectionClaims` field at all — a pre-claim client):
 * plain LWW on the client stamp, exactly as before.
 */
function mergeSection<T>(
  stored: BoardSection<T>,
  incoming: BoardSection<T>,
  clean: (raw: unknown) => T,
  key: BoardSectionKey,
  now: number,
  sectionClaims: readonly BoardSectionKey[] | undefined,
): BoardSection<T> {
  if (sectionClaims !== undefined) {
    return sectionClaims.includes(key) ? { value: clean(incoming.value), at: now } : stored
  }
  const at = typeof incoming.at === 'number' && Number.isFinite(incoming.at) ? incoming.at : 0
  if (at < stored.at) return stored
  return { value: clean(incoming.value), at }
}

/** One incoming task row, normalized through the persisted-ledger grammar
 *  (the host never trusts a replica's shape); undefined when unusable. */
function normalizeIncomingTask(task: TaskRecord): TaskRecord | undefined {
  const [row] = parseLedger(JSON.stringify([task]))
  return row
}

/** The client view of a document (what a replica feeds its stores/sections). */
export interface BoardView {
  tasks: TaskRecord[]
  cruise: CruiseValue
  schedulePresets: SchedulePreset[]
  runPresets: RunPresetsDocument
}

export function boardViewOf(doc: BoardDoc): BoardView {
  return {
    tasks: doc.tasks,
    cruise: doc.cruise.value,
    schedulePresets: doc.schedulePresets.value,
    runPresets: doc.runPresets.value,
  }
}
