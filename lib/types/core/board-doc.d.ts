import type { CruiseWindow } from './cruise.ts';
import type { RunPresetsDocument } from './run-presets.ts';
import type { TaskRecord } from './tasks.ts';
import type { SchedulePreset } from './presets.ts';
/** The cruise section value (structurally the controller's CruiseState). */
export interface CruiseValue {
    enabled: boolean;
    manual?: boolean;
    limit: number;
    schedule: CruiseWindow[];
}
/** One synced section: the value plus the client write stamp (LWW key). */
export interface BoardSection<T> {
    value: T;
    at: number;
}
/** The deletions a client observed since its baseline, with the stamp each
 *  delete was computed against. */
export interface BoardDelete {
    id: string;
    baseUpdatedAt: number;
}
/** One relayed user action: run this task with this trigger (the engine
 *  executes; a non-engine replica forwards the request through the host). */
export interface BoardCommand {
    type: 'run';
    taskId: string;
    trigger: 'manual' | 'schedule' | 'chain';
    /** The replica the user acted on (informational; the engine executes). */
    clientId: string;
}
/** Everything an SSE subscriber receives; plain JSON, one line per frame. */
export type BoardEvent = {
    type: 'commit';
    revision: number;
    clientId: string;
} | {
    type: 'lease';
    holder: string | undefined;
    expiresAt: number | undefined;
} | {
    type: 'command';
    command: BoardCommand;
};
/** The engine-lease state every board API call answers with. THE host's own
 *  production: `proto` and `bootedAt` are REQUIRED so no construction branch
 *  can ever ship a seat view that forgets them (the one hand-built literal
 *  that did is what made the "服务端未重启" banner lie forever). An answer
 *  arriving over the wire is the `LeaseWire` shape below instead. */
export interface LeaseState {
    held: boolean;
    holder: string | undefined;
    expiresAt: number | undefined;
    /** The host's lease protocol version (2 = visibility preemption). Absent on
     *  the WIRE = a host older than the flag — replicas can then TELL the user
     *  the seat may be stuck on a background device instead of leaving it
     *  mysterious. */
    proto: number;
    /** When the answering host process started serving the board. The stale-host
     *  dialog shows it, so "我明明重启了" is answered by a clock reading rather
     *  than by a guess (old process vs. a different instance behind the URL). */
    bootedAt: number;
}
/** A lease answer from an untrusted host: only `held` is guaranteed (any
 *  field may be absent on an older deployment). */
export type LeaseWire = Partial<Omit<LeaseState, 'held'>> & Pick<LeaseState, 'held'>;
/** One tombstone: the logical stamp a newer edit must beat, plus the host
 *  wall time it was written (pruning key). */
export interface Tombstone {
    at: number;
    seenAt: number;
}
/** The full authoritative document the host owns and persists. */
export interface BoardDoc {
    /** Host monotonic change counter. */
    revision: number;
    /** The task ledger (normalized rows). */
    tasks: TaskRecord[];
    /** Auto-cruise state (shared: every replica sees the same switch/limit/windows). */
    cruise: BoardSection<CruiseValue>;
    /** User schedule presets (the built-in list is never stored). */
    schedulePresets: BoardSection<SchedulePreset[]>;
    /** Run-config presets document (custom rows + default id). */
    runPresets: BoardSection<RunPresetsDocument>;
    /** taskId → tombstone; suppresses stale replicas resurrecting a delete. */
    tombstones: Record<string, Tombstone>;
    /** taskId → host wall time the row was last accepted (diagnostics). */
    stamps: Record<string, number>;
    /** When the host first created the document (migration probe). */
    bornAt: number;
}
/** The three synced sections a commit can claim authorship of. */
export type BoardSectionKey = 'cruise' | 'schedulePresets' | 'runPresets';
/** What a client sends per commit: its full view, the ids its own edits
 *  moved since the last synced baseline (authorship claims), the sections it
 *  edited, and the deletions it observed. */
export interface BoardCommit {
    clientId: string;
    tasks: readonly TaskRecord[];
    /** The records THIS replica changed against its baseline — the host takes
     *  these unconditionally (clock-independent); absence = untouched copy. */
    changed?: readonly string[];
    /** Sections THIS replica edited — accepted unconditionally and re-stamped
     *  with the host clock. An ABSENT array (a pre-claim client) falls back to
     *  section LWW; an empty array (a claim-protocol client) means "nothing to
     *  say about the sections" and skips them entirely — a stale baseline copy
     *  riding every commit can then never clobber a newer section write. */
    sectionClaims?: readonly BoardSectionKey[];
    deleted: readonly BoardDelete[];
    cruise: BoardSection<CruiseValue>;
    schedulePresets: BoardSection<SchedulePreset[]>;
    runPresets: BoardSection<RunPresetsDocument>;
}
/** Tombstones older than this are pruned (a delete this old cannot still be
 *  contested by a realistic offline replica). */
export declare const TOMBSTONE_TTL_MS: number;
/** The default cruise section value of a never-written board. */
export declare const DEFAULT_CRUISE_VALUE: CruiseValue;
/** Concurrency budget bounds — THE one declaration (the controller clamps
 *  writes through {@link clampCruiseLimit}; normalization clamps reads
 *  through it too, so a remote commit can never inject an unbounded budget). */
export declare const CRUISE_LIMIT_MIN = 1;
export declare const CRUISE_LIMIT_MAX = 20;
/** Clamp one concurrency budget to the shared bounds (THE one clamp: writes
 *  floor + clamp through this, reads normalize through this — never two
 *  grammars). NaN falls to MIN (self-guarding:
 *  no caller memory required — infinities clamp naturally to their end). */
export declare function clampCruiseLimit(value: number): number;
/** A fresh empty document (host first boot; revision 0 marks "never committed"). */
export declare function emptyBoardDoc(now: number): BoardDoc;
/** Normalize an unknown cruise value (the controller constructor's grammar,
 *  shared so host and client judge persisted cruise state identically). */
export declare function normalizeCruiseValue(value: unknown): CruiseValue;
/** Normalize an unknown persisted document (the medium's word is data, not
 *  truth: every part degrades to its empty shape rather than failing the doc).
 *  @param value - the raw medium/global value.
 *  @param now - clock for the empty/fresh fallbacks (host passes its injected
 *    clock so a first-boot document carries a deterministic birth time). */
export declare function normalizeBoardDoc(value: unknown, now?: number): BoardDoc;
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
export declare function changedIdsOf(baseline: readonly TaskRecord[], next: readonly TaskRecord[]): string[];
/** Structural equality of two documents (the "did anything move" test that
 *  keeps a no-op commit from bumping the revision and storming replicas). */
export declare function sameBoardDocs(a: BoardDoc, b: BoardDoc): boolean;
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
export declare function applyCommit(doc: BoardDoc, commit: BoardCommit, now: number): BoardDoc;
/** The client view of a document (what a replica feeds its stores/sections). */
export interface BoardView {
    tasks: TaskRecord[];
    cruise: CruiseValue;
    schedulePresets: SchedulePreset[];
    runPresets: RunPresetsDocument;
}
export declare function boardViewOf(doc: BoardDoc): BoardView;
