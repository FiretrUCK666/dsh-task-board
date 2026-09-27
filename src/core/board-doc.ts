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
import { applyRowCommit, maxSeen, mergeSection, sameMergeState } from './board-merge-core.ts'
import type { MergeDelete, MergeRowOps, MergeSection, MergeTombstone } from './board-merge-core.ts'
import { isCruiseWindow, normalizeWindow, sortWindows } from './cruise.ts'
import type { CruiseWindow } from './cruise.ts'
import { normalizeRunPresetDocument } from './run-presets.ts'
import type { RunPresetsDocument } from './run-presets.ts'
import { parseLedger } from './store.ts'
import type { TaskRecord } from './tasks.ts'
import { parsePresets } from './presets.ts'
import type { SchedulePreset } from './presets.ts'

// The grammar's laws and constants live in the kernel; this document re-exports
// the names it has always exported, so every importer keeps one path to them.
export { TOMBSTONE_TTL_MS } from './board-merge-core.ts'

/** The cruise section value (structurally the controller's CruiseState). */
export interface CruiseValue {
  enabled: boolean
  manual?: boolean
  limit: number
  schedule: CruiseWindow[]
}

/** One synced section: the value plus the client write stamp (LWW key). The
 *  shape is the kernel's; this document only names it. */
export type BoardSection<T> = MergeSection<T>

/** The deletions a client observed since its baseline, with the stamp each
 *  delete was computed against. */
export type BoardDelete = MergeDelete

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
 *  wall time it was written (pruning key). The shape is the kernel's. */
export type Tombstone = MergeTombstone

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

/** The default cruise section value of a never-written board. */
export const DEFAULT_CRUISE_VALUE: CruiseValue = { enabled: false, limit: 5, schedule: [] }

/** Concurrency budget bounds — THE one declaration (the controller clamps
 *  writes through {@link clampCruiseLimit}; normalization clamps reads
 *  through it too, so a remote commit can never inject an unbounded budget). */
export const CRUISE_LIMIT_MIN = 1
export const CRUISE_LIMIT_MAX = 20

/** Clamp one concurrency budget to the shared bounds (THE one clamp: writes
 *  floor + clamp through this, reads normalize through this — never two
 *  grammars). NaN falls to MIN (self-guarding:
 *  no caller memory required — infinities clamp naturally to their end). */
export function clampCruiseLimit(value: number): number {
  if (Number.isNaN(value)) return CRUISE_LIMIT_MIN
  return Math.min(CRUISE_LIMIT_MAX, Math.max(CRUISE_LIMIT_MIN, Math.floor(value)))
}

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
  const raw = typeof row.limit === 'number' && Number.isFinite(row.limit) ? row.limit : DEFAULT_CRUISE_VALUE.limit
  const limit = clampCruiseLimit(raw)
  return {
    enabled: row.enabled === true,
    ...(row.manual === true || row.manual === false ? { manual: row.manual } : {}),
    limit,
    schedule: Array.isArray(row.schedule)
      ? sortWindows((row.schedule as unknown[]).filter(isCruiseWindow).map(normalizeWindow))
      : [],
  }
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

/** Where a row lands: host rows keep their slots, rows the host lacked append
 *  (their `order` field carries the real column position). The array is the
 *  document's own order, so this is where a second document's ordering lives. */
function sortBoardTasks(
  hostRows: readonly TaskRecord[],
  incoming: readonly TaskRecord[],
  resolved: ReadonlyMap<string, TaskRecord>,
): TaskRecord[] {
  const tasks = hostRows.filter(task => resolved.has(task.id)).map(task => resolved.get(task.id)!)
  const seen = new Set(hostRows.map(task => task.id))
  for (const task of incoming) {
    const merged = resolved.get(task.id)
    if (merged !== undefined && !seen.has(task.id)) {
      tasks.push(merged)
      seen.add(task.id)
    }
  }
  return tasks
}

/** The board's half of the grammar: the four answers only a task ledger can
 *  give. Everything else the merge does is the kernel's. */
const TASK_ROW_OPS: MergeRowOps<TaskRecord> = {
  normalize: normalizeIncomingTask,
  authorshipKey,
  mergeReadState,
  sortRows: sortBoardTasks,
}

/** Structural equality of two documents (the "did anything move" test that
 *  keeps a no-op commit from bumping the revision and storming replicas).
 *  Composed from the kernel's part plus this document's own sections — and it
 *  is deliberately the BOARD's predicate, not a shared one: one predicate
 *  shared across two documents reads one document's unchanged state as the
 *  other's change. */
export function sameBoardDocs(a: BoardDoc, b: BoardDoc): boolean {
  return sameMergeState({ rows: a.tasks, tombstones: a.tombstones }, { rows: b.tasks, tombstones: b.tombstones })
    && JSON.stringify({ c: a.cruise, p: a.schedulePresets, r: a.runPresets })
      === JSON.stringify({ c: b.cruise, p: b.schedulePresets, r: b.runPresets })
}

/**
 * Apply one client commit to the authoritative document and return the new
 * truth (the input is never mutated). This function is the BOARD's assembly of
 * the sync contract: the rows go through the merge kernel with the four
 * answers from {@link TASK_ROW_OPS}, the three sections through the kernel's
 * section protocol. The laws themselves live in board-merge-core.ts.
 *
 * The shape of the whole contract, for anyone reading it here:
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
 * - sections: a claimed section is taken unconditionally and re-stamped with
 *   the host clock; an unclaimed one is skipped; a pre-claim client falls back
 *   to LWW on its own stamp.
 * - unchanged result → the same document object (no revision bump, no
 *   persist, no broadcast).
 */
export function applyCommit(doc: BoardDoc, commit: BoardCommit, now: number): BoardDoc {
  const merged = applyRowCommit(
    { rows: doc.tasks, tombstones: doc.tombstones, stamps: doc.stamps },
    commit.tasks,
    new Set(commit.changed ?? []),
    commit.deleted,
    TASK_ROW_OPS,
    now,
  )
  const next: BoardDoc = {
    revision: doc.revision + 1,
    tasks: merged.rows,
    cruise: mergeSection(doc.cruise, commit.cruise, normalizeCruiseValue, 'cruise', now, commit.sectionClaims),
    schedulePresets: mergeSection(doc.schedulePresets, commit.schedulePresets, parsePresetsRaw, 'schedulePresets', now, commit.sectionClaims),
    runPresets: mergeSection(doc.runPresets, commit.runPresets, normalizeRunPresetDocument, 'runPresets', now, commit.sectionClaims),
    tombstones: merged.tombstones,
    stamps: merged.stamps,
    bornAt: doc.bornAt,
  }
  return sameBoardDocs(doc, next) ? doc : next
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
