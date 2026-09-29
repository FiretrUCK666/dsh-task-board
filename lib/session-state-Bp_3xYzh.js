import { join } from "node:path";
import { readFile, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
/** The larger of two optional read stamps (undefined = never seen). A read
*  state only ever moves forward, so this join is the whole of it. */
function maxSeen(a, b) {
	if (a === void 0) return b;
	if (b === void 0) return a;
	return a >= b ? a : b;
}
/** Structural equality of a no-op predicate's inputs.
*
*  TOMBSTONES COMPARE BY STAMP ONLY. `row` is excluded on purpose, and the
*  reason is about convergence rather than tidiness: a payload is something
*  the host may hold and a replica may not, so including it would make two
*  documents that agree on every fact compare unequal, and each one's commit
*  would then look like a change to the other. Two devices would ping-pong the
*  same commit for as long as both stayed online. The row leaving `rows` is
*  already the change the predicate reports; the copy inside the tombstone
*  adds no fact to it. */
function sameMergeState(a, b) {
	return JSON.stringify({
		r: a.rows,
		x: stampsOf(a.tombstones)
	}) === JSON.stringify({
		r: b.rows,
		x: stampsOf(b.tombstones)
	});
}
/** The two stamps of each tombstone, with everything else dropped. */
function stampsOf(tombstones) {
	const out = {};
	for (const [id, tomb] of Object.entries(tombstones)) out[id] = [tomb.at, tomb.seenAt];
	return out;
}
/**
* Apply one replica's row commit to the host's rows and return the merged
* state (the input is never mutated — both maps are copies).
*
* The contract, in the order it is applied:
*
* - put: a row the host lacks is inserted unless a tombstone outranks it (then
*   the delete stands) and its tombstone is cleared; a row the host has is
*   replaced when the replica CLAIMS it (content-equal claims are no-ops) or,
*   unclaimed, when the incoming copy is simply newer. Every acceptance is
*   stamped with the host clock.
* - read state joins onto whichever row won, including when none did.
* - delete: honored only when the host copy is not newer than the baseline the
*   delete was computed against; deleting an id the host never had is a no-op
*   and leaves any existing tombstone alone. What the tombstone KEEPS is the
*   document's call (see {@link MergeRowOps.retainDeleted}); a document that
*   does not opt in gets a bare stamp, exactly as before.
* - pruning: tombstones past their TTL (and the stamps of rows long gone).
*   Anything a tombstone carried goes with it, so a document that keeps deleted
*   text keeps it for exactly as long as the tombstone survives and no longer.
*/
function applyRowCommit(state, incoming, claimed, deleted, ops, now) {
	const tombstones = { ...state.tombstones };
	const stamps = { ...state.stamps };
	const result = new Map(state.rows.map((row) => [row.id, row]));
	const sentAt = /* @__PURE__ */ new Map();
	for (const row of incoming) sentAt.set(row.id, Math.max(sentAt.get(row.id) ?? -Infinity, row.updatedAt));
	for (const raw of incoming) {
		const row = ops.normalize(raw);
		if (row === void 0) continue;
		const host = result.get(row.id);
		if (host === void 0) {
			const tomb = tombstones[row.id];
			if (tomb !== void 0 && row.updatedAt <= tomb.at) continue;
			delete tombstones[row.id];
			result.set(row.id, row);
			stamps[row.id] = now;
			continue;
		}
		let winner;
		if (claimed.has(row.id)) {
			if (ops.authorshipKey(host) !== ops.authorshipKey(row)) winner = row;
		} else if (row.updatedAt > host.updatedAt) winner = row;
		const merged = ops.mergeReadState(winner ?? host, row);
		if (winner !== void 0) {
			result.set(row.id, merged);
			stamps[row.id] = now;
		} else if (merged !== host) result.set(row.id, merged);
	}
	for (const del of deleted) {
		const host = result.get(del.id);
		if (host === void 0) continue;
		if (host.updatedAt > del.baseUpdatedAt) continue;
		const newest = Math.max(host.updatedAt, sentAt.get(del.id) ?? -Infinity, 0);
		const kept = ops.retainDeleted?.(host);
		result.delete(del.id);
		delete stamps[del.id];
		tombstones[del.id] = kept === void 0 ? {
			at: newest + 1,
			seenAt: now
		} : {
			at: newest + 1,
			seenAt: now,
			row: kept
		};
	}
	for (const [id, tomb] of Object.entries(tombstones)) if (now - tomb.seenAt > 2592e6 && !result.has(id)) delete tombstones[id];
	for (const id of Object.keys(stamps)) if (!result.has(id)) delete stamps[id];
	return {
		rows: ops.sortRows(state.rows, incoming, result),
		tombstones,
		stamps
	};
}
/**
* Section merge. CLAIM protocol (a commit carrying `sectionClaims`): only a
* claimed section is taken — unconditionally, re-stamped with the host clock
* (client clocks never decide a section) — and an unclaimed section is
* SKIPPED, so the baseline copy every commit rides can never clobber a newer
* write. LEGACY (no `sectionClaims` field at all — a pre-claim client): plain
* LWW on the client stamp, ties by arrival, so the later commit wins
* deterministically.
*
* @param key - this document's name for the section. The claim list is keyed
*  by it, which is why the kernel takes a name and not a set of sections: which
*  sections exist is the document's business.
*/
function mergeSection(stored, incoming, clean, key, now, sectionClaims) {
	if (sectionClaims !== void 0) return sectionClaims.includes(key) ? {
		value: clean(incoming.value),
		at: now
	} : stored;
	const at = typeof incoming.at === "number" && Number.isFinite(incoming.at) ? incoming.at : 0;
	if (at < stored.at) return stored;
	return {
		value: clean(incoming.value),
		at
	};
}
//#endregion
//#region src/core/item.ts
/** The closed status enum, in display order (进行中 is derived, never listed). */
const ITEM_STATUSES = [
	"open",
	"blocked",
	"done"
];
/**
* The four priority tiers, listed LOW to HIGH — an ENUM order, not a ranking.
*
* Read it wherever tiers are LISTED (a dropdown, a filter menu, a `oneOf` the
* catalog renders). Never sort on it: {@link itemPriorityRankOf} is the scale
* that orders, and it runs the other way.
*/
const ITEM_PRIORITIES = [
	"low",
	"normal",
	"high",
	"urgent"
];
/**
* The tiers on the scale every ORDERING reads: the loud one is SMALL, so an
* ascending compare puts 紧急 first.
*
* IT LIVES HERE, IN THE MODEL, AND NOT BESIDE THE TIER LIST, because the two are
* opposites and that is the trap. {@link ITEM_PRIORITIES} is declared lowest-first
* because that is how the tiers are named in a table, and sorting on its index
* puts the reader's most urgent row at the bottom of the page — which is exactly
* what happened: the document's own order and the surface's 「优先级」 were two
* rulers pointing opposite ways, and the panel's comment claimed they were one.
* So there is ONE rank table, in the one module that owns what a priority IS, and
* both orderings read it.
*
* `ITEM_PRIORITIES` keeps its own order for the places that genuinely want the
* tiers listed low to high (a settings list, a completion menu). Those are
* allowed to read the enum; nothing that ORDERS is.
*
* @param priority - the tier.
* @returns 0 for the loudest, rising as the row matters less. Ties never happen:
*   every tier has a rank, which is what lets an ordering stay a total one.
*/
const PRIORITY_RANKS = {
	urgent: 0,
	high: 1,
	normal: 2,
	low: 3
};
/**
* How loud a tier is, as a number small enough to sort on.
* @param priority - the tier.
* @returns 0 for 紧急, 3 for 低; never a tie between two different tiers.
*/
function itemPriorityRankOf(priority) {
	return PRIORITY_RANKS[priority];
}
/**
* The one status derivation. 进行中 is not stored: it is whatever the LINKED
* card is doing, read from the card's own live state — a second derivation
* would be a second opinion, and the same card would then show two different
* things in two places. A row with no card is never 进行中.
*
* @param linkedRunning - the linked card's live state (a card with no open run
*  passes false). The caller reads it; this function never guesses it.
*/
function itemStatusOf(item, linkedRunning) {
	if (item.status === "done") return "done";
	if (item.status === "blocked") return "blocked";
	return linkedRunning && item.taskId !== void 0 ? "inProgress" : "open";
}
/** The title a surface shows: the row's own, else the body's first line. */
function itemTitleOf(item) {
	if (item.title !== "") return item.title;
	for (const line of item.body.split("\n")) {
		const trimmed = line.trim();
		if (trimmed !== "") return trimmed.replace(/^#+\s*/, "");
	}
	return "";
}
/**
* The three dates, checked against each other.
*
* The order is not a convention: `startsAfter` is when the work may begin, so a
* start date after the wanted-by date is a promise the row cannot keep, and
* `hardDueAt` is the one date that does not move, so a softer date past it is a
* promise the reader has already broken. A row holding an impossible pair
* renders as a schedule that cannot be believed, and nothing about it looks
* wrong on screen.
*
* The conflict is REPORTED, never repaired. Silently swapping or clamping the
* two would leave the reader's words changed with no note that they were, and a
* quietly edited date is worse than an obviously broken one — so the write path
* refuses and the surface says why.
* @param item - the row.
* @returns the first violated pair, or `undefined` when the three agree.
*/
function itemDateConflict(item) {
	if (item.startsAfter !== void 0 && item.dueAt !== void 0 && item.startsAfter > item.dueAt) return {
		field: "startsAfter",
		value: item.startsAfter,
		limit: item.dueAt
	};
	if (item.dueAt !== void 0 && item.hardDueAt !== void 0 && item.dueAt > item.hardDueAt) return {
		field: "dueAt",
		value: item.dueAt,
		limit: item.hardDueAt
	};
	if (item.startsAfter !== void 0 && item.hardDueAt !== void 0 && item.startsAfter > item.hardDueAt) return {
		field: "startsAfter",
		value: item.startsAfter,
		limit: item.hardDueAt
	};
}
/**
* Mint a row, ready for the document to accept.
*
* ONE CONSTRUCTOR FOR BOTH WRITERS. A row used to be built twice — once by the
* interface, once by the model — and that is how two halves of one document
* drift into disagreeing about what a freshly written row looks like. Both go
* through this, so the fields that must always agree always do.
*
* The id and the ORIGIN are parameters, and neither is defaulted. The number is
* the document's to hand out, and the origin is the audit trail's handle which
* {@link ITEM_FIELDS} forbids anyone from rewriting — so both are facts the
* writer supplies rather than guesses this function would make on its behalf.
* @param input - what the writer decided.
* @param origin - who wrote it, and when.
* @param id - the identity the document will key on.
* @param now - the writing clock, stamped on both ends of the row.
* @returns a row carrying `ref: 0`, which means "not numbered yet".
*/
function newItem(input, origin, id, now) {
	return {
		id,
		ref: 0,
		title: input.title.trim(),
		body: input.body.trim(),
		notes: input.notes.trim(),
		steps: input.steps === void 0 ? [] : input.steps.map((step) => ({ ...step })),
		status: input.status,
		priority: input.priority,
		tags: input.tags === void 0 ? [] : [...input.tags],
		startsAfter: input.startsAfter,
		dueAt: input.dueAt,
		hardDueAt: input.hardDueAt,
		taskId: input.taskId,
		origin: { ...origin },
		createdAt: now,
		updatedAt: now
	};
}
/**
* Structural check for a persisted row: what makes a row a ROW. Status and
* priority stay free (the normalizers below repair them), and so do the steps'
* own entries — those are repaired one by one in {@link normalizeSteps}.
*
* ONE DELIBERATE DIVERGENCE FROM THE LEDGER GRAMMAR. `parseLedger` drops a
* whole task when one of its execution rounds is malformed, and that is right
* there: a round is a fact about a run, and silently keeping the card without it
* would misreport its history. A checklist step is a line the person typed, and
* the blast radius is the other way round — dropping the whole item (body,
* notes, three dates) to fix one checkbox is the bug, not the repair. So the
* row is checked and the entries are repaired.
*/
/**
* The shape guard, exported because it is a CONTRACT and not a private helper.
*
* Everything downstream — the merge, the sort, the row projection — assumes a row
* that passed here has FINITE numbers, because a `NaN` comparator does not throw:
* `Array.prototype.sort` treats it as "equal", so the order quietly becomes
* arrival order and two devices holding one document render two different lists.
* A guard whose failure mode is invisible has to be reachable from a test, and it
* was not.
*/
function isItemRecordShape(value) {
	if (typeof value !== "object" || value === null) return false;
	const row = value;
	if (typeof row.id !== "string" || row.id === "") return false;
	if (typeof row.title !== "string") return false;
	if (typeof row.body !== "string") return false;
	if (typeof row.notes !== "string") return false;
	if (typeof row.createdAt !== "number" || !Number.isFinite(row.createdAt)) return false;
	if (typeof row.updatedAt !== "number" || !Number.isFinite(row.updatedAt)) return false;
	if (row.taskId !== void 0 && typeof row.taskId !== "string") return false;
	if (!Array.isArray(row.steps)) return false;
	if (typeof row.origin !== "object" || row.origin === null) return false;
	const origin = row.origin;
	if (origin.source !== "human" && origin.source !== "ai" && origin.source !== "import") return false;
	if (typeof origin.at !== "number") return false;
	if (origin.sessionId !== void 0 && typeof origin.sessionId !== "string") return false;
	return true;
}
/**
* A finite timestamp, or undefined for every other shape (including NaN).
*
* EXPORTED, because "can this value be a moment" is one question with three
* callers — the persisted row, the model writing a date, and a fresh capture —
* and it lives next to the field ruling that says what a date MEANS. A value
* that is not a finite number is not a promise; it is a sentence somebody typed
* where a calendar was expected, and storing it would produce a row whose date
* sorts and renders as though it were a day.
*/
function itemInstantOf(raw) {
	return typeof raw === "number" && Number.isFinite(raw) ? raw : void 0;
}
/**
* Tags: strings only, blanks dropped, order kept, duplicates folded.
*
* One grammar for the persisted row and for a writer's list alike, so the same
* words cannot be filed twice on one surface and once on the other. Order is
* kept because a tag list is read as a phrase, and the first tag is the one a
* reader is most likely to have meant first.
*/
function itemTagsOf(raw) {
	if (!Array.isArray(raw)) return [];
	const tags = [];
	for (const entry of raw) {
		if (typeof entry !== "string") continue;
		const tag = entry.trim();
		if (tag === "" || tags.includes(tag)) continue;
		tags.push(tag);
	}
	return tags;
}
/** Steps: an entry is kept when its id and text are readable, malformed ones
*  dropped, ids made unique. A `done` that is not a boolean reads as NOT done:
*  a wrongly-ticked box hides work that still exists, while a wrongly-unticked
*  one only shows work that is there. The text is the person's, so a corrupt
*  checkbox must never cost them the line. */
function normalizeSteps(raw) {
	if (!Array.isArray(raw)) return [];
	const steps = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) continue;
		const step = entry;
		if (typeof step.id !== "string" || step.id === "") continue;
		if (typeof step.text !== "string") continue;
		if (steps.some((existing) => existing.id === step.id)) continue;
		steps.push({
			id: step.id,
			text: step.text,
			done: step.done === true
		});
	}
	return steps;
}
/**
* Parse + repair a persisted checklist document; unusable rows are dropped.
* Mirrors the ledger's grammar deliberately (same failure behaviour, same
* console discipline, same "repair the field, never fail the row" law) so the
* two documents cannot drift into different standards for the same mistake.
*
* @param raw - the persisted JSON text.
* @param mintRef - the document's short-number counter. Required, not
*  defaulted: a row's number is the document's to hand out, and a silent
*  fallback that mints the same number twice would make two rows answer to
*  one name.
*/
function parseItems(raw, mintRef) {
	if (raw === null) return [];
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		console.error("[dsh-task-board] persisted checklist is not valid JSON; starting empty", error);
		return [];
	}
	if (!Array.isArray(parsed)) {
		console.error("[dsh-task-board] persisted checklist is not an array; starting empty");
		return [];
	}
	const items = [];
	for (const row of parsed) {
		if (!isItemRecordShape(row)) {
			console.warn("[dsh-task-board] dropping invalid checklist row", row);
			continue;
		}
		const rawRef = row.ref;
		const ref = typeof rawRef === "number" && Number.isInteger(rawRef) && rawRef > 0 ? rawRef : mintRef();
		items.push({
			id: row.id,
			ref,
			title: row.title,
			body: row.body,
			notes: row.notes,
			steps: normalizeSteps(row.steps),
			status: ITEM_STATUSES.includes(row.status) ? row.status : "open",
			priority: ITEM_PRIORITIES.includes(row.priority) ? row.priority : "normal",
			tags: itemTagsOf(row.tags),
			startsAfter: itemInstantOf(row.startsAfter),
			dueAt: itemInstantOf(row.dueAt),
			hardDueAt: itemInstantOf(row.hardDueAt),
			taskId: typeof row.taskId === "string" && row.taskId !== "" ? row.taskId : void 0,
			origin: {
				source: row.origin.source,
				at: row.origin.at,
				...row.origin.sessionId !== void 0 && row.origin.sessionId !== "" ? { sessionId: row.origin.sessionId } : {}
			},
			createdAt: row.createdAt,
			updatedAt: row.updatedAt
		});
	}
	return items;
}
//#endregion
//#region src/core/items-doc.ts
/**
* The items document — the SECOND synced document, and the first consumer of
* the merge kernel. It is a sibling of the board ledger, not a view over it:
* its own document, its own truth, its own tombstone space, its own no-op
* predicate, and its own short-number counter.
*
* Everything below is the board's grammar (board-merge-core.ts) with five
* answers supplied, and nothing more. That the KERNEL needed no change to
* carry a document this different is the point of having extracted it — and it
* is checked, not assumed: the board's own spec is unchanged, so the kernel's
* behaviour on the board is the same behaviour it had before this file existed.
*
* ── THE SHORT NUMBER (`ref`), the one invariant this document owns ──────────
*
* A replica creates items optimistically, so it mints a number long before the
* host has seen the row. Two replicas that have not seen each other mint the
* SAME number for two different items, and the kernel will happily accept both:
* rows merge by identity (`id`) and freshness (`updatedAt`), and `ref` is just
* a field inside a row. Uniqueness is therefore NOT a merge invariant — it is
* a DOCUMENT invariant, and this file is where it is enforced.
*
* THE LAW: the document is the only authority on a number, and every number
* entering it — from any replica, from any field repair, from a corrupt file —
* passes through ONE chokepoint, {@link assignItemRefs}, AFTER the merge:
*
*  - a number that is positive and NOT currently in use is KEPT. A replica's
*    optimistic guess is honoured, so the ordinary single-device case displays
*    the very number the device already showed, and nothing ever flickers.
*  - a number that is missing, malformed, or ALREADY TAKEN is replaced with the
*    smallest free number at or above the document's counter. Two racing
*    replicas therefore end up 13 and 14 — no duplicate, no gap, and the same
*    answer whoever arrives first, because the host's serial order is the
*    arbiter (the same law the board already uses for equal stamps).
*
* WHY THE HOST ARBITRATES RATHER THAN LEAVING NUMBERS TO CLIENTS. Two options
* were weighed. "Clients never mint" is collision-proof by construction, but
* the panel is offline-first with a debounced commit, so every new row would
* sit unnumbered until the round trip — and an unnumbered row cannot be
* referred to ("把第 3 条改了"), which is exactly the receipt PRD §4.2 calls the
* precondition for continuous conversation. Host-arbitrated minting keeps the
* number on screen from the first frame, and a re-mint only ever fires in a
* genuine two-device race — where somebody is wrong regardless. The only
* question that race leaves open is whether the wrongness is silent and
* permanent, or one hop and converged; this design is the second.
*
* WHAT THIS COSTS, STATED RATHER THAN DISCOVERED. A collision leaves no gap (13
* and 14, dense). A CLAIM that reintroduces a number another row now holds does:
* the number that row vacated is not reissued, so the list ends up with a hole
* where it used to be. That is the deliberate trade — a gap is invisible in a
* checklist, while the alternative (a number changing under a person who just
* read it out loud) is a lie told to their face. The kernel is what makes the
* vacated number unreachable: the claim is taken whole, number included, and by
* then the document no longer knows the row ever held it.
*
* WHY THE COUNTER IS STORED AND NOT DERIVED FROM THE ROWS. A derived counter
* (`max(refs) + 1`) would hand a DELETED item's number to the next item, and
* since checklist deletions are recoverable (they go through a tombstone), a
* later restore would put two `#60`s on the board — the same collision,
* arriving through the back door. So `nextRef` is document state. Which is why
* it is part of THIS document's no-op predicate (the board's `stamps` is
* deliberately not part of the board's): a commit that mints a number has
* changed the document, and a counter allowed to roll back on a no-op would
* re-mint a number that is in use.
*
* ── WHY THIS DOCUMENT HAS NO SECTIONS ───────────────────────────────────────
*
* The board carries three synced sections beside its rows; the checklist
* carries none, so an items commit has no `sectionClaims` and never calls the
* kernel's section protocol. That is a fact about this document, not a missing
* feature: adding a section later means giving it a claim protocol here, not
* widening the kernel.
*/
/** A fresh empty checklist (host first boot; revision 0 marks "never committed"). */
function emptyItemsDoc(now) {
	return {
		revision: 0,
		items: [],
		tombstones: {},
		stamps: {},
		nextRef: 1,
		bornAt: now
	};
}
/** The highest number any row actually carries (0 for an empty checklist). */
function highestRefOf(items) {
	let highest = 0;
	for (const item of items) if (item.ref > highest) highest = item.ref;
	return highest;
}
/**
* THE SHORT-NUMBER CHOKEPOINT. The only place a number is handed out, and the
* only place uniqueness is decided (see the module header for why this is a
* document invariant rather than a merge one).
*
* A number is kept when it is a positive integer nothing else in this document
* is using; otherwise the row is re-stamped with the smallest free number above
* every number the document already holds AND above `nextRef`. Both halves of
* that sentence matter: a replica's own free guess is often far ahead of the
* stored counter (a long-offline device mints 13 off a max of 12), so seeding
* the counter from the stored value alone would hand the next collision a
* number BELOW one already in use — and a list whose numbers run backwards is
* worse than a list with a gap in it.
*
* Runs AFTER the merge, so a row that lost the merge never consumes a number,
* and re-mints a row that arrived with a number somebody else already holds —
* which is also how a checklist that was already broken (a hand-edited file, two
* devices that raced before this law existed) heals on the next commit instead
* of staying broken.
*/
function assignItemRefs(items, nextRef) {
	const taken = /* @__PURE__ */ new Set();
	const numbered = [];
	let counter = Math.max(1, Math.trunc(nextRef), highestRefOf(items) + 1);
	for (const item of items) {
		if (Number.isInteger(item.ref) && item.ref > 0 && !taken.has(item.ref)) {
			taken.add(item.ref);
			numbered.push(item);
			continue;
		}
		while (taken.has(counter)) counter++;
		taken.add(counter);
		numbered.push(counter === item.ref ? item : {
			...item,
			ref: counter
		});
		counter++;
	}
	return {
		items: numbered,
		nextRef: counter
	};
}
/**
* One row's authorship fingerprint, and it deliberately EXCLUDES the short
* number. `ITEM_FIELDS` rules `ref` `derived` — the document's to hand out — so
* a claim must not be able to carry one, exactly as a claim must not be able to
* carry the board's read state. Without this, a replica whose copy predates a
* collision correction would claim the stale number back on every edit and the
* correction would never settle.
*
* The fields are listed one by one rather than spread, so the fingerprint
* cannot silently change meaning if a field is added to the row or the parse
* order is ever reordered.
*/
function itemAuthorshipKey(item) {
	return JSON.stringify({
		id: item.id,
		title: item.title,
		body: item.body,
		notes: item.notes,
		steps: item.steps,
		status: item.status,
		priority: item.priority,
		tags: item.tags,
		startsAfter: item.startsAfter,
		dueAt: item.dueAt,
		hardDueAt: item.hardDueAt,
		taskId: item.taskId,
		origin: item.origin,
		createdAt: item.createdAt,
		updatedAt: item.updatedAt
	});
}
/** The number the sort reads for "when is this wanted" — unset rows sort last. */
const UNSET_DATE = Number.MAX_SAFE_INTEGER;
function wantedAt(item) {
	const dates = [
		item.startsAfter,
		item.dueAt,
		item.hardDueAt
	].filter((at) => at !== void 0);
	return dates.length === 0 ? UNSET_DATE : Math.min(...dates);
}
const STATUS_RANK = {
	open: 0,
	blocked: 1,
	done: 2
};
/**
* The short number as an ordering key, with "nobody has numbered me yet" at the
* END rather than at zero.
*
* THE SENTINEL IS NOT USABLE AS A BARE NUMBER IN A SORT, and this is the second
* time that lesson has cost something (the first was `Infinity` in the date
* columns). `ref: 0` is the document's own "not numbered yet" marker, and
* subtracting it raw makes every unnumbered row compare as the SMALLEST — so
* every optimistic row a replica has just created lands at the TOP of the
* reader's list, pushing their existing work down, on the very ordering the
* product made the default. The same trick as the date sentinel, and for the same
* reason: a large FINITE end is the only value that can be subtracted.
*
* On the HOST this branch never fires, because {@link assignItemRefs} has handed
* out a real number to every row before anything is sorted — which is exactly why
* the bug survived here for as long as it did: the host is the one place it
* cannot be seen.
*
* @param item - the row.
* @returns its number, or a value past every real one when it has none yet.
*/
function refRankOf(item) {
	return item.ref > 0 ? item.ref : UNSET_DATE;
}
/**
* The document's own order, as a COMPARATOR — five keys, in this order:
* unfinished first, then urgency, then whichever of the three dates is nearest,
* then age, then the short number.
*
* WHY IT IS A SEPARATE COMPARATOR AND NOT ONLY A SORT. The panel offers this
* order to the reader as 顺序, and the reader's 顺序 and the document's stored
* order are the same promise: two devices holding one document show the same
* list. Written twice — once as the merge's `sortRows` and once as a surface
* option — the two would be free to disagree about which of two rows comes
* first, and the list a person sees would stop being the list the document
* holds. So the keys live here and the surface composes them with its own
* tie-break tail (a replica can hold two rows the host has not numbered yet, so
* the short number alone is not yet a total order there).
*
* EVERY KEY IS FINITE AND EVERY KEY BREAKS A TIE, which is the whole law. The
* urgency scale is the MODEL's ({@link itemPriorityRankOf}, loudest first) rather
* than a second ranking written here: the enum in `item.ts` is declared low to
* high for the dropdown, and reading its index as a rank produced a 优先级 that
* put 紧急 last while this order put it first — two rulers, opposite directions,
* in the same panel.
*
* The short number is unique in a settled document, so on the host the
* comparison is TOTAL and the result cannot depend on the order the rows
* arrived in; on a replica {@link refRankOf} keeps that true for the rows the
* host has not numbered yet.
*
* @param a - the left row.
* @param b - the right row.
* @returns negative, zero or positive; zero means "these five keys say nothing",
*   which is a real answer the caller must finish itself.
*/
function compareItemOrder(a, b) {
	return STATUS_RANK[a.status] - STATUS_RANK[b.status] || itemPriorityRankOf(a.priority) - itemPriorityRankOf(b.priority) || wantedAt(a) - wantedAt(b) || a.createdAt - b.createdAt || refRankOf(a) - refRankOf(b);
}
/**
* The document's own order, and a PURE FUNCTION of the document — which the
* board cannot say of its own (a card's slot is a manual drag, so two devices
* can disagree about it and the host settles it by arrival). The checklist has
* no manual order (the new-field admission rule kept `order` out of the model),
* so its order is derived, so two replicas holding the same rows show the same
* list without ever syncing the order itself.
*
* @param rows - the finished rows (numbers assigned, tombstones settled).
*/
function sortItems(rows) {
	return [...rows].sort(compareItemOrder);
}
/** What the inbound grammar writes for a number it could not read. NOT a usable
*  number: the document's chokepoint mints the real one after the merge, so a
*  row that LOSES the merge never burns a number. */
const UNSET_REF = 0;
/** One incoming row through the checklist's own grammar. The host never trusts
*  a replica's shape, and {@link parseItems} is where that is said. */
function normalizeIncomingItem(item) {
	return parseItems(JSON.stringify([item]), () => UNSET_REF)[0];
}
/** The checklist's half of the grammar: the four answers only a checklist can
*  give. Everything else the merge does is the kernel's.
*
*  Exported so the answers themselves can be pinned, and one of them cannot be
*  pinned any other way: `mergeReadState` is the IDENTITY, and its entire
*  correctness is that it is invisible from outside (an equal copy would still
*  compare equal, so every document-level test would pass with the bug in
*  place). A guarantee nobody can reach is a guarantee nobody has checked. */
const ITEM_ROW_OPS = {
	normalize: normalizeIncomingItem,
	authorshipKey: itemAuthorshipKey,
	/**
	* THE IDENTITY, and that is the correct implementation rather than a missing
	* one. This document has no read state: `ITEM_FIELDS` carries no `viewedAt`,
	* because the checklist is scanned rather than watched and the board's unread
	* reminder has no business on a row that is not a run. A join of nothing with
	* nothing is the identity.
	*
	* It must return the winner OBJECT, not an equal copy: the kernel reads
	* `merged !== host` as "the read state moved", so a fresh-but-identical object
	* would make every untouched commit look like a change — a revision bump and a
	* broadcast on every keystroke's round trip, for nothing.
	*/
	mergeReadState: (winner) => winner,
	sortRows: (_hostRows, _incoming, resolved) => sortItems([...resolved.values()]),
	/**
	* This document's deletions are reversible, so a tombstone keeps the row.
	*
	* The checklist is a page of things a person wrote down; a delete that takes
	* the words with it makes the promise "删除后这一条仍可恢复" — which the panel
	* prints in front of the reader — untrue, and untrue in the one place where
	* being wrong costs somebody a thought. The board does not keep its own
	* deleted cards, for the opposite and equally good reason: a card can be
	* rebuilt from its own prompt, and keeping every card's attachments for the
	* tombstone's whole life is a bill neither document should pay for the other.
	*
	* The row is kept AS IT STOOD, taken from the host copy, so what comes back
	* is what the document actually held rather than whatever the deleting
	* replica happened to be carrying.
	*/
	retainDeleted: (item) => item
};
/** Structural equality of two checklists — the "did anything move" test that
*  keeps a no-op commit from bumping the revision and storming replicas.
*
*  This is the CHECKLIST's own predicate and must never be shared with the
*  board's. One predicate across two documents reads one document's unchanged
*  state as the other document's change, and the replica that believes it loses
*  its queue in silence. It is composed from the kernel's part, which IS shared,
*  plus this document's own state.
*/
function sameItemsDocs(a, b) {
	return sameMergeState({
		rows: a.items,
		tombstones: a.tombstones
	}, {
		rows: b.items,
		tombstones: b.tombstones
	}) && a.nextRef === b.nextRef;
}
/**
* Apply one replica's commit to the authoritative checklist and return the new
* truth (the input is never mutated). The order of the three steps is the
* design: merge, then hand out numbers, then order — so a number is only ever
* minted for a row that survived, and the order is a function of the finished
* document.
*
* The merge itself is the board's, unchanged: an unclaimed row merges by
* `updatedAt` (host wins ties), a claimed row is taken unconditionally, a
* tombstone outranks a stale copy, and a row whose content loses still has its
* read state joined — which for this document means the identity above.
*/
function applyItemsCommit(doc, commit, now) {
	const merged = applyRowCommit({
		rows: doc.items,
		tombstones: doc.tombstones,
		stamps: doc.stamps
	}, commit.items, new Set(commit.changed ?? []), commit.deleted, ITEM_ROW_OPS, now);
	const numbered = assignItemRefs(merged.rows, doc.nextRef);
	const next = {
		revision: doc.revision + 1,
		items: sortItems(numbered.items),
		tombstones: merged.tombstones,
		stamps: merged.stamps,
		nextRef: numbered.nextRef,
		bornAt: doc.bornAt
	};
	return sameItemsDocs(doc, next) ? doc : next;
}
/**
* The rows a delete left behind, newest delete first.
*
* This is the ARCHIVE, and it is a read over tombstones rather than a second
* store: the text a removed row keeps lives in the tombstone that removed it,
* so the archive cannot fall out of step with the deletions the way a
* separate list would. A tombstone that carries no row contributes nothing —
* which is the honest answer for a delete that predates this rule or that the
* TTL has already pruned, and is why "可恢复" is a window with an end rather
* than a promise without one.
*
* Recoverable until {@link TOMBSTONE_TTL_MS} after the delete; past that the
* tombstone is pruned whole and the row is gone for good.
*
* @param doc - the authoritative checklist.
* @returns one row per tombstone that still holds one, newest delete first.
*/
function deletedItemsOf(doc) {
	const kept = [];
	for (const tomb of Object.values(doc.tombstones)) {
		if (tomb.row === void 0) continue;
		const item = tomb.row;
		kept.push({
			item,
			seenAt: tomb.seenAt
		});
	}
	return kept.sort((a, b) => b.seenAt - a.seenAt || a.item.id.localeCompare(b.item.id)).map((entry) => entry.item);
}
/**
* The row to put back for a restore, or `undefined` when there is nothing to
* put back.
*
* RESTORING IS AN ORDINARY PUT, and the only thing this function has to do is
* re-stamp. A tombstone outranks the row it removed (its `at` is one
* millisecond above the row's own freshness), so handing the payload back
* un-stamped would be read as the stale copy it exists to suppress and the
* row would silently not come back. Pushing the stamp above the tombstone is
* the same shape as a concurrent revive, which the kernel already takes, so
* there is no restore path to get wrong: the caller sends this row as a claimed
* put and the ordinary chokepoint re-numbers it if the document has handed its
* number to somebody else in the meantime.
*
* @param doc - the authoritative checklist.
* @param id - the id to bring back.
* @param now - the clock the restored row is stamped with. It must be the
*   HOST's, since the tombstone it has to outrank is the host's.
* @returns the row to commit, or `undefined` when the id is not recoverable.
*/
function restoredItemOf(doc, id, now) {
	const tomb = doc.tombstones[id];
	if (tomb?.row === void 0) return void 0;
	return {
		...tomb.row,
		updatedAt: Math.max(now, tomb.at + 1)
	};
}
/** Normalize an unknown persisted document: the medium's word is data, not
*  truth. Junk degrades to the empty shape, rows go through the checklist's own
*  grammar, and the short-number law runs here too — a file that was already
*  broken heals on load instead of waiting for the next commit. */
function normalizeItemsDoc(value, now = Date.now()) {
	if (typeof value !== "object" || value === null) return emptyItemsDoc(now);
	const row = value;
	const revision = typeof row.revision === "number" && Number.isFinite(row.revision) && row.revision >= 0 ? Math.floor(row.revision) : 0;
	const bornAt = typeof row.bornAt === "number" && Number.isFinite(row.bornAt) ? row.bornAt : now;
	const items = Array.isArray(row.items) ? parseItems(JSON.stringify(row.items), () => UNSET_REF) : [];
	const numbered = assignItemRefs(items, Math.max(highestRefOf(items) + 1, 1));
	const tombstones = {};
	if (typeof row.tombstones === "object" && row.tombstones !== null) for (const [id, entry] of Object.entries(row.tombstones)) {
		if (typeof entry !== "object" || entry === null) continue;
		const tomb = entry;
		if (typeof tomb.at !== "number" || !Number.isFinite(tomb.at)) continue;
		const kept = tomb.row === void 0 ? void 0 : normalizeIncomingItem(tomb.row);
		tombstones[id] = {
			at: tomb.at,
			seenAt: typeof tomb.seenAt === "number" && Number.isFinite(tomb.seenAt) ? tomb.seenAt : bornAt,
			...kept !== void 0 ? { row: kept } : {}
		};
	}
	const stamps = {};
	if (typeof row.stamps === "object" && row.stamps !== null) {
		for (const [id, at] of Object.entries(row.stamps)) if (typeof at === "number" && Number.isFinite(at) && at >= 0) stamps[id] = at;
	}
	const storedNext = typeof row.nextRef === "number" && Number.isFinite(row.nextRef) ? Math.trunc(row.nextRef) : 0;
	return {
		revision,
		items: sortItems(numbered.items),
		tombstones,
		stamps,
		nextRef: Math.max(storedNext, numbered.nextRef, 1),
		bornAt
	};
}
//#endregion
//#region src/core/tasks.ts
/** The task's live bindings: the multi-source list, with the legacy single
*  `bind` field projected as a one-element list (old data parses untouched).
*  EVERY reader goes through here — never the raw field. */
function taskBindsOf(task) {
	const binds = task.binds;
	if (binds !== void 0 && binds.length > 0) return binds;
	return task.bind !== void 0 ? [task.bind] : [];
}
/** Brand an unknown string as a schedule mode. */
function isScheduleMode(value) {
	return value === "cron" || value === "chain";
}
/** Statuses a user may move a card to manually (execution states are owned by the runner). */
const MANUAL_STATUSES = [
	"backlog",
	"todo",
	"done"
];
/** All valid statuses (closed union guard). */
const ALL_STATUSES = [
	"backlog",
	"todo",
	"running",
	"review",
	"done"
];
/** Brand an unknown string as a status; undefined when it is not one. */
function isTaskStatus(value) {
	return typeof value === "string" && ALL_STATUSES.includes(value);
}
/**
* Whether the task has anything EXECUTABLE to drive: its execution prompt is
* non-empty (trimmed). THE one judgment every drive path reads — a task with
* no prompt can never be run, automated, cruised or comment-driven.
* Empty means strictly blank; placeholder text is not empty.
*/
function taskExecutable(task) {
	return task.prompt.trim() !== "";
}
/**
* Whether a NEW arm of the task's schedule rule is refused outright. THE one
* judgment every arming path reads — the controller's write and the editor's
* switch both call it, so "the switch says on" and "the rule is armed" can
* never disagree.
*
* A rule drives its task through the task's own execution prompt, so a task
* with no prompt has nothing to run in EITHER mode: cron would fire into a
* no-op and chain would never hand off. Arming is therefore refused for both,
* and the editor renders the switch as unusable with the reason beside it
* rather than accepting an arm that can never fire.
*
* Disarming is always allowed — a rule already armed before the prompt was
* cleared stays visible and dis-armable, and {@link ruleReadiness} reports it
* as blocked in the meantime.
*/
function ruleArmingBlocked(task) {
	return !taskExecutable(task);
}
/**
* Disarm a task's schedule rule for good — the completed-task shut-off. The
* rule's identity (cron expression, mode, budget, prime, counters) is kept
* so re-arming it later resumes from the same configured behavior; only
* `enabled` and the pending `nextRunAt` are cleared. A no-op on tasks with
* no rule or an already-disarmed one.
*/
function disarmSchedule(task, now) {
	const schedule = task.schedule;
	if (schedule === void 0 || !schedule.enabled) return task;
	return withSchedule(task, {
		enabled: false,
		nextRunAt: void 0
	}, now);
}
/** Whether a raw value is a storable prompt image (non-empty data + a media
*  type string). Deliberately LENIENT (no whitelist): storage walls must
*  never retroactively delete what an older version stored — the whitelist
*  gates new intake and the send layer, never the ledger. Crash-safety (no
*  undefined derefs downstream) is what storage guarantees. */
function isWellFormedImage(entry) {
	if (typeof entry !== "object" || entry === null) return false;
	const candidate = entry;
	return typeof candidate.data === "string" && candidate.data !== "" && typeof candidate.mediaType === "string" && candidate.mediaType !== "";
}
/** Whether a raw value is a storable file ref (non-empty receipt + name;
*  bytes only needs to be a number for display math — NaN displays ugly but
*  never crashes and never deletes). Same leniency law as images above. */
function isWellFormedFile(entry) {
	if (typeof entry !== "object" || entry === null) return false;
	const candidate = entry;
	return typeof candidate.receiptId === "string" && candidate.receiptId !== "" && typeof candidate.name === "string" && candidate.name !== "" && typeof candidate.bytes === "number";
}
/** Keep well-formed prompt images (a dirty element washes out, never the
*  row and never a downstream crash). */
function normalizePromptImages(raw) {
	if (!Array.isArray(raw)) return void 0;
	const kept = raw.filter(isWellFormedImage);
	return kept.length > 0 ? kept : void 0;
}
/** Keep well-formed file refs (same law as images). */
function normalizePromptFiles(raw) {
	if (!Array.isArray(raw)) return void 0;
	const kept = raw.filter(isWellFormedFile);
	return kept.length > 0 ? kept : void 0;
}
/** Create a task from user input. */
function createTask(input, now, id, order = 0) {
	const status = input.status ?? "todo";
	return {
		id,
		title: input.title.trim(),
		description: input.description.trim(),
		prompt: input.prompt.trim(),
		status,
		order,
		createdAt: now,
		updatedAt: now,
		viewedAt: now,
		statusHistory: [{
			status,
			at: now
		}],
		executions: [],
		...input.promptImages !== void 0 && input.promptImages.length > 0 ? { promptImages: input.promptImages.map((image) => ({ ...image })) } : {},
		...input.promptFiles !== void 0 && input.promptFiles.length > 0 ? { promptFiles: input.promptFiles.map((file) => ({ ...file })) } : {},
		...input.workspaceId !== void 0 ? { workspaceId: input.workspaceId } : {},
		...input.provider !== void 0 ? { provider: input.provider } : {},
		...input.model !== void 0 ? { model: input.model } : {},
		...input.reasoningEffort !== void 0 ? { reasoningEffort: input.reasoningEffort } : {},
		...input.agentPreset !== void 0 ? { agentPreset: input.agentPreset } : {},
		...input.permission !== void 0 ? { permission: input.permission } : {},
		...input.color !== void 0 && input.color !== "" ? { color: input.color } : {}
	};
}
/** Clone a task with an updated status and a fresh updatedAt. A real column
*  move appends to the status history (cycle/streak/throughput derivations
*  read it — without it every duration is a guess); a same-status touch only
*  refreshes updatedAt. A legacy row moving for the first time backfills its
*  birth column from createdAt (the honest birth instant, same as the read
*  path — one birth rule, never two). */
function withStatus(task, status, now) {
	if (task.status === status) return {
		...task,
		updatedAt: now
	};
	const birthAt = Number.isFinite(task.createdAt) && task.createdAt > 0 ? task.createdAt : task.updatedAt;
	const birth = task.statusHistory === void 0 ? [{
		status: task.status,
		at: birthAt
	}] : [];
	return {
		...task,
		status,
		updatedAt: now,
		statusHistory: [
			...birth,
			...task.statusHistory ?? [],
			{
				status,
				at: now
			}
		]
	};
}
/**
* Merge a schedule patch into a task's schedule rule (creating it when
* absent), with a fresh updatedAt. Keys present in the patch overwrite the
* current value — including explicit `undefined`, which clears a field (used
* to disarm `nextRunAt`); absent keys keep their current value.
*/
function withSchedule(task, patch, now) {
	const current = task.schedule;
	const schedule = {
		enabled: current?.enabled ?? false,
		mode: current?.mode ?? "cron",
		cron: current?.cron ?? "",
		nextRunAt: current?.nextRunAt,
		lastTriggeredAt: current?.lastTriggeredAt,
		maxRuns: current?.maxRuns,
		runCount: current?.runCount ?? 0,
		missedToleranceMs: current?.missedToleranceMs,
		primed: true
	};
	if ("enabled" in patch) schedule.enabled = patch.enabled ?? false;
	if ("mode" in patch) schedule.mode = patch.mode ?? "cron";
	if ("cron" in patch) schedule.cron = patch.cron ?? "";
	if ("nextRunAt" in patch) schedule.nextRunAt = patch.nextRunAt;
	if ("lastTriggeredAt" in patch) schedule.lastTriggeredAt = patch.lastTriggeredAt;
	if ("maxRuns" in patch) schedule.maxRuns = patch.maxRuns;
	if ("runCount" in patch) schedule.runCount = patch.runCount ?? 0;
	if ("missedToleranceMs" in patch) schedule.missedToleranceMs = patch.missedToleranceMs;
	return {
		...task,
		updatedAt: now,
		schedule
	};
}
/**
* Whether the card already holds completed work awaiting the human gate:
* any settled round with a succeeded/failed outcome (plain runs,
* comment continuations, externally-observed turns, direct sends — all are
* completions the user has not confirmed). Cancelled rounds never count:
* they are noise/abort, not work.
* Used ONLY to decide where a `cancelled` settle lands (review vs todo) —
* success/failure always land in review (or stay running for incomplete
* batches/chains or sibling lanes).
*/
function hasCompletedWork(task) {
	return task.executions.some((round) => round.endedAt !== void 0 && (round.result === "succeeded" || round.result === "failed"));
}
/**
* THE one column decision for every settle (success/failure/
* cancel). Pure so the whole board — live watches, reconciles, watchdogs,
* spurious-external sweeps — lands in the same column for the same facts.
* Priority:
* 0. another lane still open, or a related session still working → `running`
*    (the column and the card's light both read this one fact: a card whose
*    session is working must never be written out of 进行中 — the yellow
*    border without the breath AND the "settled while the subagent still
*    runs" bug are the same disagreement);
* 1. succeeded/failed → `review` (chain/batch incomplete stays `running`);
* 2. cancelled → keep a parked column as-is; from `running`, return to
*    `review` when completed work exists (the human gate survives noise),
*    else `todo` (nothing completed — back to the queue).
* `stillWorking` is the ACTIVITY leg (`taskLiveStateOf(...) === 'running'`,
* i.e. this session's own turn or a running subagent descendant — see
* session-activity.ts). It is a separate parameter from `othersOpen` on
* purpose: `othersOpen` counts THIS CARD's other open rounds, while the
* activity leg is the native truth about the related sessions. Folding one
* into the other is how the two readings drift apart again.
*/
function settleColumnOf(task, outcome, othersOpen, chainIncomplete, batchIncomplete, stillWorking = false) {
	if (othersOpen || stillWorking) return "running";
	if (outcome === "cancelled") {
		if (task.status !== "running") return task.status;
		return hasCompletedWork(task) ? "review" : "todo";
	}
	if (chainIncomplete || batchIncomplete) return "running";
	return "review";
}
/**
* Whether ONE round is genuinely in flight (someone is working on it right
* now), as opposed to saved-and-waiting or already settled. The single
* structural judgment behind `openRoundsOf` — derived from the round itself,
* never from the card's column, so a card parked mid-flight still reports the
* work that is really running.
*
* Enumerated by KIND (each category is real, and a comment body does NOT mean
* "queued" — an observed native turn carries its user text too):
* - a plain run: in flight from creation until it settles;
* - an EXTERNAL round (a native turn the board observed): in flight while
*   open — it is already happening, it is never queued or injected, and its
*   `comment` is only the thread body;
* - a comment round: in flight only ONCE INJECTED. A saved comment is queued
*   — it must never show a spinner, block a rerun, hold a slot or mark its
*   session busy.
*/
function isOpenRound(round) {
	if (round.endedAt !== void 0) return false;
	if (round.external === true) return true;
	if (round.comment !== void 0) return round.injectedAt !== void 0;
	return true;
}
/** Every in-flight round of a task, in submission order. THE truth the
*  dispatcher, the budget and the column state machine all read — a card may
*  legitimately run several sessions at once (one lane per session), so
*  "the task's latest execution" is no longer the only thing that can be
*  running. */
function openRoundsOf(task) {
	return task.executions.filter(isOpenRound);
}
//#endregion
//#region src/core/task-live.ts
/**
* THE related-session set of a task (de-duplicated, stable order — binds
* first, then execution rounds, then injected linked ids; the same order
* every consumer has always read):
* - every bound session source (session binds; a workspace bind contributes
*   through the linked ids below),
* - every session an execution round ran in,
* - every live linked session id the caller derived from the native
*   workspace snapshots (`linkedSessionIdsOf`) — bound workspaces surface
*   their CURRENT members, so a workspace member counts without ever having
*   carried a board round.
*
* `removedSessions` is the authoritative NOT-related gate and is subtracted
* from EVERY source here — the same set the display rows already filter on, so
* a session the user deleted from the card (hidden-tray 删除) can never drive
* the card's live state or an external round, even while its session bind
* lingers (the bind survives when a workspace bind is also present). The
* corollary the add-session picker relies on: a removed session leaves this
* set, so it becomes re-offerable again (删除 = 可再拖回/再选回).
* @param task - the task owning the sessions.
* @param linkedSessionIds - the task's live linked-session ids (the
*   controller derives them from the workspaces face; undefined = skip).
*/
function relatedSessionIdsOf(task, linkedSessionIds) {
	const removed = new Set(task.removedSessions ?? []);
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	const push = (sessionId) => {
		if (sessionId === void 0 || sessionId === "" || seen.has(sessionId) || removed.has(sessionId)) return;
		seen.add(sessionId);
		out.push({ sessionId });
	};
	for (const bind of taskBindsOf(task)) if (bind.kind === "session") push(bind.sessionId);
	for (const round of task.executions) push(round.sessionId);
	for (const sessionId of linkedSessionIds ?? []) push(sessionId);
	return out;
}
/** The schedule-continuation half of the justification above: an armed rule
*  whose budget still has a run left (chain and budgeted cron share one
*  shape here — the settle path reads the same two counters, only adjusted
*  for when each path increments them, see the branches). Unbudgeted cron
*  never holds the column: a cron with no `maxRuns` keeps nothing pending
*  between fires, so its card settles to review like any plain run. */
function scheduleGapHolds(task) {
	const schedule = task.schedule;
	if (schedule === void 0 || !schedule.enabled || !taskExecutable(task)) return false;
	if (schedule.mode === "chain") return schedule.maxRuns === void 0 || schedule.runCount + 1 < schedule.maxRuns;
	return schedule.maxRuns !== void 0 && schedule.runCount < schedule.maxRuns;
}
/**
* The single leave-`running` judgment: why the card may stay, undefined when
* it must leave. `live` is the native truth (`taskLiveStateOf` on the same
* related set the caller renders from). `ignoreSchedule` drops the schedule
* leg — a deletion that removed in-flight work is a cancellation (the work
* is gone, there is nothing to continue), never a batch gap.
*/
function runningJustificationOf(task, live, opts = {}) {
	if (task.status !== "running") return void 0;
	if (openRoundsOf(task).length > 0) return "open";
	if (live !== "idle") return "live";
	if (!opts.ignoreSchedule && scheduleGapHolds(task)) return "schedule";
}
/**
* Where a `running`-column card with NO justification leaves to — the
* cancellation semantics of `settleColumnOf` (a card holding completed work
* keeps its human gate in review, otherwise it returns to the queue).
* `undefined` = the card stays (either it is not in `running`, or one of
* the three legs above still holds it).
*/
function leaveRunningTargetOf(task, live, opts = {}) {
	if (task.status !== "running") return void 0;
	if (runningJustificationOf(task, live, opts) !== void 0) return void 0;
	return settleColumnOf(task, "cancelled", false, false, false);
}
//#endregion
//#region src/core/cruise.ts
/** One calendar day (cross-midnight normalization). */
const DAY_MS = 864e5;
/** Brand an unknown value as a valid window (persisted-state guard). */
function isCruiseWindow(value) {
	if (typeof value !== "object" || value === null) return false;
	const window = value;
	const startOk = window.startAt === void 0 || typeof window.startAt === "number" && Number.isFinite(window.startAt);
	const endOk = window.endAt === void 0 || typeof window.endAt === "number" && Number.isFinite(window.endAt);
	return startOk && endOk && (typeof window.startAt === "number" || typeof window.endAt === "number");
}
/**
* Normalize a window: a within-the-same-intent end earlier than the start is
* a cross-midnight window (22:00 → 02:00 is legal) — yield the end on the
* start's next day. An end more than a whole day BEFORE the start is NOT a
* cross-midnight window; it is a date mistake (windowRangeIssueOf returns
* 'end-too-early') and is left as-entered — the editor rejects it with a
* specific message instead of the stale rule silently surviving as a
* "everyday 22:00→01:00 of yesterday" artifact.
*/
function normalizeWindow(window) {
	const startAt = window.startAt;
	let endAt = window.endAt;
	if (startAt !== void 0 && endAt !== void 0 && endAt <= startAt && endAt > startAt - 864e5) endAt += DAY_MS;
	return {
		...startAt !== void 0 ? { startAt } : {},
		...endAt !== void 0 ? { endAt } : {}
	};
}
/**
* The sort key of one window: start-less (only-end = 立即开启) leads, then
* windows ascend by start; a tie on start ascends by end, an open end
* (stays on) last. The list order is derived — never a stored order.
*/
function windowSortKeyOf(window) {
	return {
		start: window.startAt ?? 0,
		end: window.endAt ?? Number.MAX_SAFE_INTEGER
	};
}
/** Sort windows: 立即开启 (start-less) first, then by start, then by end. */
function sortWindows(windows) {
	return [...windows].sort((a, b) => {
		const keyA = windowSortKeyOf(a);
		const keyB = windowSortKeyOf(b);
		return keyA.start - keyB.start || keyA.end - keyB.end;
	});
}
//#endregion
//#region src/core/run-presets.ts
/**
* Run-config presets: named run configurations (the workspace / provider /
* model / effort / agent-preset / permission set of a task card) that the
* task form picks from. User-customizable — add / edit / delete your own,
* and mark ANY preset (including the built-in one) as the DEFAULT applied
* when creating a new task. Framework-free and unit-testable.
*
* The fallback chain is the whole point: the built-in 部署默认 preset is an
* EMPTY config (every field follows the deployment's native defaults) and is
* never deletable. A missing or dangling defaultId — never created any
* preset, deleted the preset that was the default, corrupt storage — always
* resolves to 部署默认 (the previous behavior), so there is no broken state
* and no migration: the old default IS the deployment default.
*/
/**
* The run-config fields, as ONE list.
*
* This list was written out seven times across the repository, and two of those
* copies were `as const` loops — the shape that compiles forever. So a seventh run
* field was added to the card and to this interface, and both write paths went on
* ignoring it with nothing red anywhere: the detail pane's editor, the model's
* `task.update`, and the model's preset reader. The failure it produced is the
* worst shape a write can take — **the model was told 「已生效」 about a field that
* had not changed** — and no gate could see it, because each copy was a complete,
* valid list of the keys that copy knew about.
*
* So the list lives here, once, and the interface is DERIVED from it. That turns
* the silent case into a build failure: a loop over the wrong list, or a field
* added to the interface by hand, no longer type-checks, because there is now one
* answer and the others are expressions over it rather than fresh literals.
*
* `color` is deliberately NOT here. It is a run-adjacent field the model can set,
* but it is not part of what a preset pins — a preset that coloured your cards
* would be a different feature with a different lifetime — so it is applied by its
* own one rule in the two places that accept it.
*/
const RUN_CONFIG_KEYS = [
	"workspaceId",
	"provider",
	"model",
	"reasoningEffort",
	"agentPreset",
	"permission"
];
/** The six run-config keys a preset may carry (unknown keys are stripped). */
const CONFIG_KEYS = [
	"workspaceId",
	"provider",
	"model",
	"reasoningEffort",
	"agentPreset",
	"permission"
];
/** Structural row check: non-empty id/name strings + a clean config object. */
function isPresetShape$1(value) {
	if (typeof value !== "object" || value === null) return false;
	const row = value;
	if (typeof row.id !== "string" || row.id === "") return false;
	if (typeof row.name !== "string" || row.name === "") return false;
	if (row.id === "deploy-default") return false;
	return typeof row.config === "object" && row.config !== null;
}
/** Keep only the known config keys with string values. */
function cleanConfig(value) {
	if (typeof value !== "object" || value === null) return {};
	const source = value;
	const cleaned = {};
	for (const key of CONFIG_KEYS) {
		const entry = source[key];
		if (typeof entry === "string") cleaned[key] = entry;
	}
	return cleaned;
}
/** Normalize a raw row list: valid custom presets only, duplicates dropped. */
function normalizeRunPresets(value) {
	if (!Array.isArray(value)) return [];
	const seen = /* @__PURE__ */ new Set();
	const rows = [];
	for (const entry of value) {
		if (!isPresetShape$1(entry)) continue;
		if (seen.has(entry.id)) continue;
		seen.add(entry.id);
		rows.push({
			id: entry.id,
			name: entry.name,
			config: cleanConfig(entry.config)
		});
	}
	return rows;
}
/** Normalize a whole persisted document (corrupt → built-in only). */
function normalizeRunPresetDocument(value) {
	if (typeof value !== "object" || value === null) return { presets: [] };
	const row = value;
	const presets = normalizeRunPresets(row.presets);
	const defaultId = typeof row.defaultId === "string" && row.defaultId !== "" ? row.defaultId : void 0;
	return {
		presets,
		...defaultId !== void 0 ? { defaultId } : {}
	};
}
//#endregion
//#region src/core/schedule.ts
/** Inclusive ranges per field, in cron order. */
const FIELD_RANGES = [
	[0, 59],
	[0, 23],
	[1, 31],
	[1, 12],
	[0, 7]
];
/**
* Parse a 5-field cron expression.
* @returns the match sets, or null when the expression is invalid.
*/
function parseCron(expr) {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) return null;
	const sets = [];
	for (let index = 0; index < 5; index++) {
		const [min, max] = FIELD_RANGES[index];
		const set = /* @__PURE__ */ new Set();
		if (!parseField(fields[index], min, max, set)) return null;
		sets.push(set);
	}
	const weekdays = /* @__PURE__ */ new Set();
	for (const day of sets[4]) weekdays.add(day === 7 ? 0 : day);
	return {
		minutes: sets[0],
		hours: sets[1],
		days: sets[2],
		months: sets[3],
		weekdays,
		dayWildcard: fields[2] === "*",
		weekdayWildcard: fields[4] === "*"
	};
}
/** Whether the expression parses. */
function isValidCron(expr) {
	return parseCron(expr) !== null;
}
/**
* Compute the next matching instant after `fromMs` (ms epoch), in local time,
* at minute granularity, strictly greater than `fromMs`. Returns the ms epoch
* of the matching minute's start, or undefined when nothing matches within
* 366 days (e.g. `0 0 30 2 *`).
*/
function nextRunAtMs(expr, fromMs) {
	const schedule = parseCron(expr);
	if (schedule === null) return void 0;
	const from = new Date(fromMs);
	const scan = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes() + 1, 0, 0);
	const limitMs = fromMs + 366 * 24 * 60 * 60 * 1e3;
	while (scan.getTime() <= limitMs) {
		if (matches(schedule, scan)) return scan.getTime();
		scan.setMinutes(scan.getMinutes() + 1);
	}
}
/** Parse one comma-list field into the match set. */
function parseField(field, min, max, out) {
	if (field === "*") {
		for (let value = min; value <= max; value++) out.add(value);
		return true;
	}
	for (const part of field.split(",")) {
		if (part === "") return false;
		const [range, stepRaw] = part.split("/");
		let low;
		let high;
		if (range === "*") {
			low = min;
			high = max;
		} else if (range.includes("-")) {
			const [a, b] = range.split("-");
			if (a === "" || b === "" || !isDigits(a) || !isDigits(b)) return false;
			low = Number(a);
			high = Number(b);
		} else if (isDigits(range)) {
			low = Number(range);
			high = Number(range);
		} else return false;
		if (low < min || high > max || low > high) return false;
		const step = stepRaw === void 0 ? 1 : isDigits(stepRaw) ? Number(stepRaw) : NaN;
		if (!Number.isInteger(step) || step < 1) return false;
		for (let value = low; value <= high; value += step) out.add(value);
	}
	return true;
}
/** Day/weekday OR semantics: a restricted day field alone gates, and vice versa. */
function matches(schedule, date) {
	if (!schedule.minutes.has(date.getMinutes())) return false;
	if (!schedule.hours.has(date.getHours())) return false;
	if (!schedule.months.has(date.getMonth() + 1)) return false;
	const dayMatches = schedule.days.has(date.getDate());
	const weekdayMatches = schedule.weekdays.has(date.getDay());
	if (schedule.dayWildcard) return weekdayMatches;
	if (schedule.weekdayWildcard) return dayMatches;
	return dayMatches || weekdayMatches;
}
function isDigits(value) {
	return /^\d+$/.test(value);
}
//#endregion
//#region src/core/automation.ts
/** Brand an unknown value as a valid rule (persisted-state guard). */
function isSessionRule(value) {
	if (typeof value !== "object" || value === null) return false;
	const rule = value;
	if (typeof rule.id !== "string" || rule.id === "") return false;
	if (typeof rule.sessionId !== "string" || rule.sessionId === "") return false;
	const usePrompt = rule.usePrompt === true;
	if (typeof rule.instruction !== "string" || rule.instruction === "" && !usePrompt) return false;
	if (rule.send !== "queue" && rule.send !== "steer") return false;
	if (typeof rule.enabled !== "boolean") return false;
	if ((rule.trigger === "on-complete" ? "on-complete" : "cron") === "on-complete") return rule.nextAt === void 0;
	if (typeof rule.cron !== "string" || rule.cron === "") return false;
	if (rule.enabled === false) return true;
	return typeof rule.nextAt === "number" && Number.isFinite(rule.nextAt);
}
/** Parse + validate a persisted rule list (invalid rows dropped; legacy rows
*  without a trigger normalize to cron, without usePrompt to custom text). */
function normalizeSessionRules(raw) {
	if (!Array.isArray(raw)) return void 0;
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const row of raw) {
		if (!isSessionRule(row) || seen.has(row.id)) continue;
		seen.add(row.id);
		const trigger = row.trigger === "on-complete" ? "on-complete" : "cron";
		out.push({
			id: row.id,
			sessionId: row.sessionId,
			instruction: row.instruction,
			...row.usePrompt === true ? { usePrompt: true } : {},
			trigger,
			...trigger === "cron" ? {
				cron: row.cron,
				nextAt: row.nextAt
			} : { cron: "" },
			send: row.send,
			enabled: row.enabled,
			...typeof row.lastAt === "number" ? { lastAt: row.lastAt } : {}
		});
	}
	return out.length > 0 ? out : void 0;
}
/** Add / replace rules immutably on a task. */
function withSessionRules(task, rules) {
	if (rules === void 0 || rules.length === 0) {
		const next = { ...task };
		if ("rules" in next) delete next.rules;
		return next;
	}
	return {
		...task,
		rules
	};
}
/** Switch every session rule of a task off (the done-column shut-off: a
*  completed task's rules must never fire again, exactly like its schedule
*  disarms — the configuration survives, so re-arming resumes each rule).
*  Due slots clear with the switch (a re-armed rule recomputes from now —
*  a stale slot must never surprise-fire on resume, task-level disarm law). */
function disarmSessionRules(task) {
	if (task.rules === void 0) return task;
	return withSessionRules(task, task.rules.map((rule) => ({
		...rule,
		enabled: false,
		nextAt: void 0,
		lastAt: void 0
	})));
}
//#endregion
//#region src/core/store.ts
/**
* Task persistence: a small storage seam with a localStorage backend.
*
* The task-board client plugin runs in the browser, and dsh exposes no
* browser-writable file channel, so tasks persist in the browser's
* localStorage under a versioned key — the same persistence mechanism dsh's
* own client snapshot stores use (`createSnapshotStore` persist). Data
* survives page refreshes and dsh restarts (same origin), and survives
* plugin uninstall (the key is simply left in place).
*
* The seam keeps the backend swappable (e.g. an IndexedDB or a host-file
* channel later); tests run against the in-memory backend and a jsdom
* localStorage backend.
*/
/**
* Structural row check with the status left unvalidated (see {@link parseLedger}).
* The `schedule` field is deliberately NOT checked here: a malformed schedule
* never drops the task row — {@link normalizeSchedule} repairs or drops the
* schedule alone.
*/
function isTaskRecordShape(value) {
	if (typeof value !== "object" || value === null) return false;
	const record = value;
	if (typeof record.id !== "string" || record.id === "") return false;
	if (typeof record.title !== "string") return false;
	if (typeof record.description !== "string") return false;
	if (typeof record.prompt !== "string") return false;
	if (typeof record.createdAt !== "number") return false;
	if (typeof record.updatedAt !== "number") return false;
	if (!Array.isArray(record.executions)) return false;
	for (const execution of record.executions) {
		if (typeof execution !== "object" || execution === null) return false;
		const entry = execution;
		if (typeof entry.id !== "string") return false;
		if (entry.sessionId !== void 0 && typeof entry.sessionId !== "string") return false;
		if (typeof entry.startedAt !== "number") return false;
		if (entry.endedAt !== void 0 && typeof entry.endedAt !== "number") return false;
		if (entry.result !== void 0 && entry.result !== "succeeded" && entry.result !== "failed" && entry.result !== "cancelled") return false;
		if (entry.error !== void 0 && typeof entry.error !== "string") return false;
	}
	return true;
}
/** Normalize an unknown persisted status back into the closed status union. */
function normalizeStatus(status) {
	if (isTaskStatus(status)) return status;
	if (status === "failed") return "review";
	return "todo";
}
/**
* Repair a persisted schedule rule: drop rules without a usable cron string
* (cron mode), coerce booleans/numbers, normalize the mode (legacy rules
* default to 'cron'), and leave `nextRunAt`/`lastTriggeredAt` undefined
* when missing (a fresh recompute or the next tick fixes them).
*/
function normalizeSchedule(schedule) {
	if (typeof schedule !== "object" || schedule === null) return void 0;
	const rule = schedule;
	const mode = isScheduleMode(rule.mode) ? rule.mode : "cron";
	if (typeof rule.cron !== "string") {
		if (mode !== "chain") return void 0;
	} else if (mode === "cron" && (rule.cron.trim() === "" || !isValidCron(rule.cron))) return;
	const maxRuns = rule.maxRuns;
	const runCount = rule.runCount;
	const missedToleranceMs = rule.missedToleranceMs;
	return {
		enabled: rule.enabled === true,
		mode,
		cron: typeof rule.cron === "string" ? rule.cron : "",
		nextRunAt: typeof rule.nextRunAt === "number" ? rule.nextRunAt : void 0,
		lastTriggeredAt: typeof rule.lastTriggeredAt === "number" ? rule.lastTriggeredAt : void 0,
		maxRuns: typeof maxRuns === "number" && Number.isInteger(maxRuns) && maxRuns > 0 ? maxRuns : void 0,
		runCount: typeof runCount === "number" && Number.isInteger(runCount) && runCount >= 0 ? runCount : 0,
		missedToleranceMs: typeof missedToleranceMs === "number" && Number.isFinite(missedToleranceMs) && missedToleranceMs > 0 ? Math.floor(missedToleranceMs) : void 0,
		primed: true
	};
}
/** Parse + validate a persisted ledger document; invalid rows are dropped. */
function parseLedger(raw) {
	if (raw === null) return [];
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		console.error("[dsh-task-board] persisted task ledger is not valid JSON; starting empty", error);
		return [];
	}
	if (!Array.isArray(parsed)) {
		console.error("[dsh-task-board] persisted task ledger is not an array; starting empty");
		return [];
	}
	const tasks = [];
	for (const row of parsed) {
		if (!isTaskRecordShape(row)) {
			console.warn("[dsh-task-board] dropping invalid task row from persisted ledger", row);
			continue;
		}
		const task = {
			...row,
			status: normalizeStatus(row.status)
		};
		task.schedule = normalizeSchedule(row.schedule);
		delete task.refineSessionId;
		task.executions = task.executions.filter((round) => round.refine !== true);
		const rawOrder = row.order;
		task.order = typeof rawOrder === "number" && Number.isFinite(rawOrder) ? rawOrder : tasks.length;
		const rawViewed = row.viewedAt;
		task.viewedAt = typeof rawViewed === "number" ? rawViewed : task.executions.reduce((latest, round) => Math.max(latest, round.endedAt ?? round.startedAt), 0);
		task.executions = task.executions.map((round) => {
			if (round.viewedAt !== void 0) return round;
			return {
				...round,
				viewedAt: round.endedAt ?? round.startedAt
			};
		});
		const rawBind = row.bind;
		if (rawBind?.kind === "session" && typeof rawBind.sessionId === "string") task.bind = {
			kind: "session",
			sessionId: rawBind.sessionId
		};
		else if (rawBind?.kind === "workspace" && typeof rawBind.workspaceId === "string") task.bind = {
			kind: "workspace",
			workspaceId: rawBind.workspaceId
		};
		else delete task.bind;
		const rawBinds = row.binds;
		if (Array.isArray(rawBinds)) {
			const binds = rawBinds.map((entry) => {
				if (typeof entry !== "object" || entry === null) return void 0;
				const source = entry;
				if (source.kind === "session" && typeof source.sessionId === "string") return {
					kind: "session",
					sessionId: source.sessionId
				};
				if (source.kind === "workspace" && typeof source.workspaceId === "string") return {
					kind: "workspace",
					workspaceId: source.workspaceId
				};
			}).filter((entry) => entry !== void 0);
			if (binds.length > 0) task.binds = binds;
			else delete task.binds;
		} else delete task.binds;
		const rawHidden = row.hidden;
		const cleanIdArray = (value) => {
			if (!Array.isArray(value)) return void 0;
			const ids = value.filter((item) => typeof item === "string");
			return ids.length > 0 ? ids : void 0;
		};
		if (rawHidden !== null && typeof rawHidden === "object") {
			const executions = cleanIdArray(rawHidden.executions);
			const sessions = cleanIdArray(rawHidden.sessions);
			if (executions !== void 0 || sessions !== void 0) task.hidden = {
				...executions !== void 0 ? { executions } : {},
				...sessions !== void 0 ? { sessions } : {}
			};
		}
		if (task.hidden === void 0) delete task.hidden;
		const removedSessions = cleanIdArray(row.removedSessions);
		if (removedSessions !== void 0) task.removedSessions = removedSessions;
		else delete task.removedSessions;
		const sessionsOrder = cleanIdArray(row.sessionsOrder);
		if (sessionsOrder !== void 0) task.sessionsOrder = sessionsOrder;
		else delete task.sessionsOrder;
		delete task.tags;
		delete task.dueAt;
		delete task.priority;
		delete task.labels;
		const rawColor = row.color;
		if (typeof rawColor === "string" && rawColor !== "") task.color = rawColor;
		else delete task.color;
		const rawImages = row.promptImages;
		const images = normalizePromptImages(rawImages);
		if (images !== void 0) task.promptImages = images;
		else delete task.promptImages;
		const rawFiles = row.promptFiles;
		const files = normalizePromptFiles(rawFiles);
		if (files !== void 0) task.promptFiles = files;
		else delete task.promptFiles;
		const rawHistory = row.statusHistory;
		const birthAt = typeof task.createdAt === "number" && Number.isFinite(task.createdAt) && task.createdAt > 0 ? task.createdAt : task.updatedAt;
		if (Array.isArray(rawHistory)) {
			const history = rawHistory.filter((entry) => typeof entry === "object" && entry !== null && isTaskStatus(entry.status) && typeof entry.at === "number" && Number.isFinite(entry.at) && entry.at > 0).map((entry) => ({
				status: entry.status,
				at: entry.at
			})).sort((a, b) => a.at - b.at);
			if (history.length === 0) history.push({
				status: task.status,
				at: birthAt
			});
			const last = history[history.length - 1];
			if (last !== void 0 && last.status !== task.status) history.push({
				status: task.status,
				at: task.updatedAt
			});
			task.statusHistory = history;
		} else task.statusHistory = [{
			status: task.status,
			at: birthAt
		}];
		const rules = normalizeSessionRules(row.rules);
		if (rules !== void 0) task.rules = rules;
		else delete task.rules;
		tasks.push(task);
	}
	return tasks;
}
//#endregion
//#region src/core/presets.ts
/** Structural row check: an override must carry id/label/cron strings. */
function isPresetShape(value) {
	if (typeof value !== "object" || value === null) return false;
	const row = value;
	return typeof row.id === "string" && row.id !== "" && typeof row.label === "string" && typeof row.cron === "string" && row.cron !== "";
}
/** Parse + validate the persisted override document; invalid rows are dropped. */
function parsePresets(raw) {
	if (raw === null) return [];
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		console.error("[dsh-task-board] persisted schedule presets are not valid JSON; starting with defaults", error);
		return [];
	}
	if (!Array.isArray(parsed)) {
		console.error("[dsh-task-board] persisted schedule presets are not an array; starting with defaults");
		return [];
	}
	return parsed.filter(isPresetShape);
}
//#endregion
//#region src/core/board-doc.ts
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
/** The default cruise section value of a never-written board. */
const DEFAULT_CRUISE_VALUE = {
	enabled: false,
	limit: 5,
	schedule: []
};
/** Clamp one concurrency budget to the shared bounds (THE one clamp: writes
*  floor + clamp through this, reads normalize through this — never two
*  grammars). NaN falls to MIN (self-guarding:
*  no caller memory required — infinities clamp naturally to their end). */
function clampCruiseLimit(value) {
	if (Number.isNaN(value)) return 1;
	return Math.min(20, Math.max(1, Math.floor(value)));
}
/** A fresh empty document (host first boot; revision 0 marks "never committed"). */
function emptyBoardDoc(now) {
	return {
		revision: 0,
		tasks: [],
		cruise: {
			value: DEFAULT_CRUISE_VALUE,
			at: now
		},
		schedulePresets: {
			value: [],
			at: now
		},
		runPresets: {
			value: { presets: [] },
			at: now
		},
		tombstones: {},
		stamps: {},
		bornAt: now
	};
}
/** Normalize an unknown cruise value (the controller constructor's grammar,
*  shared so host and client judge persisted cruise state identically). */
function normalizeCruiseValue(value) {
	if (typeof value !== "object" || value === null) return { ...DEFAULT_CRUISE_VALUE };
	const row = value;
	const limit = clampCruiseLimit(typeof row.limit === "number" && Number.isFinite(row.limit) ? row.limit : DEFAULT_CRUISE_VALUE.limit);
	return {
		enabled: row.enabled === true,
		...row.manual === true || row.manual === false ? { manual: row.manual } : {},
		limit,
		schedule: Array.isArray(row.schedule) ? sortWindows(row.schedule.filter(isCruiseWindow).map(normalizeWindow)) : []
	};
}
/** Normalize an unknown section carrying a value + write stamp. */
function normalizeSection(value, at, fallback, clean) {
	if (typeof value !== "object" || value === null) return {
		value: fallback,
		at
	};
	const row = value;
	const stamp = typeof row.at === "number" && Number.isFinite(row.at) ? row.at : at;
	return {
		value: clean(row.value),
		at: stamp
	};
}
/** Normalize an unknown persisted document (the medium's word is data, not
*  truth: every part degrades to its empty shape rather than failing the doc).
*  @param value - the raw medium/global value.
*  @param now - clock for the empty/fresh fallbacks (host passes its injected
*    clock so a first-boot document carries a deterministic birth time). */
function normalizeBoardDoc(value, now = Date.now()) {
	if (typeof value !== "object" || value === null) return emptyBoardDoc(now);
	const row = value;
	const revision = typeof row.revision === "number" && Number.isFinite(row.revision) && row.revision >= 0 ? Math.floor(row.revision) : 0;
	const bornAt = typeof row.bornAt === "number" && Number.isFinite(row.bornAt) ? row.bornAt : now;
	const tasks = Array.isArray(row.tasks) ? parseLedger(JSON.stringify(row.tasks)) : [];
	const tombstones = {};
	if (typeof row.tombstones === "object" && row.tombstones !== null) for (const [id, entry] of Object.entries(row.tombstones)) {
		if (typeof entry !== "object" || entry === null) continue;
		const t = entry;
		if (typeof t.at !== "number" || !Number.isFinite(t.at)) continue;
		tombstones[id] = {
			at: t.at,
			seenAt: typeof t.seenAt === "number" && Number.isFinite(t.seenAt) ? t.seenAt : bornAt
		};
	}
	const empty = emptyBoardDoc(bornAt);
	const stamps = {};
	if (typeof row.stamps === "object" && row.stamps !== null) {
		for (const [id, at] of Object.entries(row.stamps)) if (typeof at === "number" && Number.isFinite(at) && at >= 0) stamps[id] = at;
	}
	return {
		revision,
		tasks,
		cruise: normalizeSection(row.cruise, empty.cruise.at, DEFAULT_CRUISE_VALUE, normalizeCruiseValue),
		schedulePresets: normalizeSection(row.schedulePresets, empty.schedulePresets.at, [], parsePresetsRaw),
		runPresets: normalizeSection(row.runPresets, empty.runPresets.at, { presets: [] }, normalizeRunPresetDocument),
		tombstones,
		stamps,
		bornAt
	};
}
/** Presets arrive as a raw JSON array (the persisted shape); parsePresets
*  works on the JSON text, so round-trip through it for one grammar. */
function parsePresetsRaw(raw) {
	if (!Array.isArray(raw)) return [];
	return parsePresets(JSON.stringify(raw));
}
/** One row's authorship fingerprint: its JSON minus every read-state field. */
function authorshipKey(task) {
	const { viewedAt: _taskViewed, ...rest } = task;
	return JSON.stringify({
		...rest,
		executions: task.executions.map(({ viewedAt: _roundViewed, ...round }) => round)
	});
}
/**
* Fold the incoming row's READ STATE into the content winner: task.viewedAt
* and each execution's viewedAt move forward only (matched by round id; a
* round the winner lacks keeps whatever the winner has). Returns the same
* object when nothing moved (no churn, no broadcast).
*/
function mergeReadState(winner, incoming) {
	const viewedAt = maxSeen(winner.viewedAt, incoming.viewedAt);
	const rounds = winner.executions.map((round) => {
		const seen = incoming.executions.find((candidate) => candidate.id === round.id);
		const roundViewed = maxSeen(round.viewedAt, seen?.viewedAt);
		return roundViewed === round.viewedAt ? round : {
			...round,
			viewedAt: roundViewed
		};
	});
	const viewMoved = viewedAt !== winner.viewedAt;
	const roundsMoved = rounds.some((round, index) => round !== winner.executions[index]);
	if (!viewMoved && !roundsMoved) return winner;
	return {
		...winner,
		viewedAt,
		executions: rounds
	};
}
/** Where a row lands: host rows keep their slots, rows the host lacked append
*  (their `order` field carries the real column position). The array is the
*  document's own order, so this is where a second document's ordering lives. */
function sortBoardTasks(hostRows, incoming, resolved) {
	const tasks = hostRows.filter((task) => resolved.has(task.id)).map((task) => resolved.get(task.id));
	const seen = new Set(hostRows.map((task) => task.id));
	for (const task of incoming) {
		const merged = resolved.get(task.id);
		if (merged !== void 0 && !seen.has(task.id)) {
			tasks.push(merged);
			seen.add(task.id);
		}
	}
	return tasks;
}
/** The board's half of the grammar: the four answers only a task ledger can
*  give. Everything else the merge does is the kernel's. */
const TASK_ROW_OPS = {
	normalize: normalizeIncomingTask,
	authorshipKey,
	mergeReadState,
	sortRows: sortBoardTasks
};
/** Structural equality of two documents (the "did anything move" test that
*  keeps a no-op commit from bumping the revision and storming replicas).
*  Composed from the kernel's part plus this document's own sections — and it
*  is deliberately the BOARD's predicate, not a shared one: one predicate
*  shared across two documents reads one document's unchanged state as the
*  other's change. */
function sameBoardDocs(a, b) {
	return sameMergeState({
		rows: a.tasks,
		tombstones: a.tombstones
	}, {
		rows: b.tasks,
		tombstones: b.tombstones
	}) && JSON.stringify({
		c: a.cruise,
		p: a.schedulePresets,
		r: a.runPresets
	}) === JSON.stringify({
		c: b.cruise,
		p: b.schedulePresets,
		r: b.runPresets
	});
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
function applyCommit(doc, commit, now) {
	const merged = applyRowCommit({
		rows: doc.tasks,
		tombstones: doc.tombstones,
		stamps: doc.stamps
	}, commit.tasks, new Set(commit.changed ?? []), commit.deleted, TASK_ROW_OPS, now);
	const next = {
		revision: doc.revision + 1,
		tasks: merged.rows,
		cruise: mergeSection(doc.cruise, commit.cruise, normalizeCruiseValue, "cruise", now, commit.sectionClaims),
		schedulePresets: mergeSection(doc.schedulePresets, commit.schedulePresets, parsePresetsRaw, "schedulePresets", now, commit.sectionClaims),
		runPresets: mergeSection(doc.runPresets, commit.runPresets, normalizeRunPresetDocument, "runPresets", now, commit.sectionClaims),
		tombstones: merged.tombstones,
		stamps: merged.stamps,
		bornAt: doc.bornAt
	};
	return sameBoardDocs(doc, next) ? doc : next;
}
/** One incoming task row, normalized through the persisted-ledger grammar
*  (the host never trusts a replica's shape); undefined when unusable. */
function normalizeIncomingTask(task) {
	const [row] = parseLedger(JSON.stringify([task]));
	return row;
}
//#endregion
//#region src/host/data-root.ts
/**
* The one place in this plugin that touches the medium outside the platform
* storage hub.
*
* Everything the board persists goes through `ctx.storage` (see
* board-service.ts): the hub owns the root directory, the unit naming rules,
* the atomic publish and the per-record layout, and this plugin has no business
* choosing any of that. What the hub CANNOT express is retiring the one file it
* no longer owns — the pre-layout whole-unit document, written before the unit
* moved to a per-record tree. That file is only reachable by path, and the hub
* exposes no path-shaped read.
*
* So this module owns exactly one job: move that file aside, once, under three
* guards, and never touch it otherwise. Moving (not deleting) is deliberate: the
* bytes stay on disk as the migration's own backup, and the renamed name no
* longer ends in `.json`, so neither the hub nor a later boot reads it again.
*
* Every path here is DISCOVERED, never hard-coded: the harness home comes from
* `$DSH_HOME` or `os.homedir()` at call time, and the unit name is a parameter.
* A deployment that relocates its home, or another machine entirely, resolves
* the same three lines without an edit.
*/
/**
* The harness home directory, resolved the way the host resolves it: an
* explicit `$DSH_HOME` wins, a blank one counts as unset, and the fallback is
* `.dsh` under the current user's home.
* @returns the absolute harness home path.
*/
function harnessHome() {
	const configured = process.env.DSH_HOME?.trim();
	return configured !== void 0 && configured !== "" ? configured : join(homedir(), ".dsh");
}
/**
* The directory the storage hub roots every unit in.
* @returns the absolute storage root path.
*/
function storagesRoot() {
	return join(harnessHome(), "storages");
}
/**
* The directory a per-record unit occupies under the storage root.
*
* This mirrors the backend's own layout rule; it is spelled out here only so
* the retirement guard can name the exact file a migrated document lands in.
* A unit that is still a single whole-unit FILE has no directory yet.
* @param unitName - the unit whose directory to locate.
* @returns the absolute unit directory path.
*/
function unitDirectoryPath(unitName) {
	return join(storagesRoot(), unitName);
}
/** A local-time `YYYYMMDD-HHmmss` suffix — readable, and unique per run. */
function retireStamp(now) {
	const d = new Date(now);
	const pad = (value) => String(value).padStart(2, "0");
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
/** Whether a path exists, without throwing on any of the ways it can fail. */
async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}
/**
* Move a pre-layout whole-unit file aside, once.
*
* The three guards exist so this can never destroy data: the data must already
* exist at its new home, the file must really be the unit document we wrote
* (a stray file of the same name is left alone), and the destination must be
* free. Every failure returns a status and changes nothing on disk.
* @param options - which file, which version, where the data landed.
* @returns what happened, with the paths involved.
*/
async function retireLegacyUnitFile(options) {
	const legacyPath = join(storagesRoot(), `${options.unitName}.json`);
	const out = (status, retiredPath) => retiredPath === void 0 ? {
		status,
		legacyPath
	} : {
		status,
		legacyPath,
		retiredPath
	};
	if (!await exists(options.migratedPath)) {
		options.log(`[dsh-task-board] legacy unit file left in place: the migrated document is not at ${options.migratedPath}`);
		return out("target-missing");
	}
	if (!await exists(legacyPath)) return out("absent");
	let header;
	try {
		header = JSON.parse(await readFile(legacyPath, "utf8"));
	} catch (error) {
		options.log(`[dsh-task-board] legacy unit file is unreadable; left in place: ${legacyPath}`, error);
		return out("foreign");
	}
	if (header.unit?.name !== options.unitName || header.unit?.version !== options.legacyVersion) {
		options.log(`[dsh-task-board] legacy unit file is not this unit's document; left in place: ${legacyPath}`);
		return out("foreign");
	}
	const retiredPath = `${legacyPath}.migrated-${retireStamp(options.now)}`;
	if (await exists(retiredPath)) return out("taken");
	try {
		await rename(legacyPath, retiredPath);
	} catch (error) {
		options.log(`[dsh-task-board] legacy unit file could not be moved aside; left in place: ${legacyPath}`, error);
		return out("target-missing");
	}
	return out("retired", retiredPath);
}
//#endregion
//#region src/host/board-service.ts
/**
* Board data service (host half): the authoritative documents every browser
* replica syncs against — today the board and the checklist — plus the two
* arbitrations multi-device correctness needs: the engine lease and the
* launch-command relay.
*
* The documents persist through the platform storage hub's `json` backend.
* The unit is opened in the `per-record` layout, so everything this plugin
* owns lives in ONE directory under the harness home's storage root with one
* human-readable JSON document per data kind — today the board and the
* checklist, and any later data kind beside them without disturbing them. The
* hub owns the root, the naming rules and the atomic publish; this plugin only
* names its unit and its documents.
*
* ONE unit carries both documents and ONE service holds the single live handle
* that name allows — the backend gives a unit exactly one live handle, so
* "a service per document" is not a choice the medium permits. That is also
* what keeps every mutation to every document on one write lane.
*
* The hub is read structurally (`ctx.get('storage')`) exactly like
* every other host route reads its service: when the deployment composes no
* storage hub, or the medium fails to open, the service reports `available:false`
* and the browser half falls back to its localStorage mode — a degraded board,
* never a broken one.
*
* The engine lease: exactly one browser drives time-based automation
* (scheduler ticks, the dispatch pump, reconciliation, external-turn
* recording). Any board API call from the current holder renews the lease
* (background-tab timer throttling cannot starve a live holder), a dropped
* SSE connection shortens it to a grace window, and expiry lets any other
* replica take over within seconds.
*
* The command relay: a non-engine replica's user-initiated run travels to
* the engine (one pump = one concurrency budget = no double launches). With
* no live engine the request parks in a small deduped queue and replays when
* the next lease is granted.
*/
/** The unit identity stamped on the medium (name must be file-safe: the
* platform's UNIT_NAME_RE is `^[a-z][a-z0-9_]*$` — underscores, not hyphens). */
const BOARD_UNIT_NAME = "dsh_task_board";
/** The one declared table; every document this plugin owns is a record in it. */
const BOARD_UNIT_TABLE = "documents";
/** The document name holding the board truth. */
const BOARD_DOCUMENT = "board";
/** The document name holding the checklist truth — the second synced document,
*  a sibling of the board rather than a view over it (its own revision, its own
*  short-number counter). */
const ITEMS_DOCUMENT = "items";
/** The document name holding migration bookkeeping — the marker that lets a
*  boot know it must never go looking for the legacy file again. */
const META_DOCUMENT = "meta";
/** The document tree this build opens. In the `per-record` layout the unit
*  NAME is also its directory name, which is why this plugin's data root reads
*  `dsh_task_board` and can never be a hyphenated directory: UNIT_NAME_RE. */
const BOARD_UNIT_DESCRIPTOR = {
	name: BOARD_UNIT_NAME,
	version: 2,
	tables: [BOARD_UNIT_TABLE],
	hasGlobal: false,
	layout: "per-record"
};
/** The pre-tree whole-unit shape, opened only while migrating. */
const LEGACY_UNIT_DESCRIPTOR = {
	name: BOARD_UNIT_NAME,
	version: 1,
	tables: [],
	hasGlobal: true,
	layout: "single"
};
/** The records of the declared table, or an empty view when it holds none. */
function documentsOf(snapshot) {
	const table = snapshot.tables?.[BOARD_UNIT_TABLE];
	return typeof table === "object" && table !== null ? table : {};
}
/**
* Open the unit, migrating the pre-tree whole-unit file exactly once.
*
* The migration must SEQUENCE two opens of one unit name, because the backend
* gives a name exactly one live handle.
*
* THE QUESTION THIS ASKS IS "HAS THIS TREE EVER BEEN WRITTEN", NOT "IS THE
* MARKER THERE" and never "is THIS document there". Those are three different
* questions, and only the first one is about the unit: a tree holding any
* record at all is already in the per-record layout, so the pre-tree file is
* stale by definition and importing it over that tree would overwrite newer
* data. A question about one document in a table of many is a question the
* next document silently loses — which is exactly how a checklist could vanish
* on a boot whose tree was missing nothing but the marker, while its own
* `items.json` sat right there on disk. So: ANY record ends the probe, and the
* marker is a record like any other.
*
* Deleting the data root is therefore a real reset, and stays one: the tree
* comes back empty, and the probe has nothing to import because the migration
* that once read the old file moved it aside (see data-root.ts).
*
* The board document is written BEFORE the marker, so a crash mid-migration
* repeats a probe that is idempotent rather than skipping one that is not. The
* value handed back is re-read from the medium rather than assembled from what
* this function remembers writing, so a record it has no name for still comes
* back.
* @param openUnit - the hub opener.
* @param now - clock for the migration stamps.
* @param log - diagnostic sink.
* @param retire - the legacy-file retirement step; injected so the migration
*  is testable without a filesystem, and so the production path stays the only
*  caller of the real one.
* @returns the open unit and every document it holds, or undefined when no hub.
*/
async function openBoardUnit(openUnit, now, log, retire = retireLegacyUnitFile) {
	let unit = await openUnit(BOARD_UNIT_DESCRIPTOR);
	if (unit === void 0) return void 0;
	let documents = documentsOf(await unit.loadAll());
	if (Object.keys(documents).length > 0) return {
		unit,
		documents
	};
	await unit.close();
	const legacy = await openUnit(LEGACY_UNIT_DESCRIPTOR);
	let legacyBoard;
	try {
		legacyBoard = legacy === void 0 ? void 0 : (await legacy.loadAll()).global;
	} finally {
		await legacy?.close();
	}
	unit = await openUnit(BOARD_UNIT_DESCRIPTOR);
	if (unit === void 0) return void 0;
	const imported = legacyBoard !== void 0 && legacyBoard !== null;
	if (imported) await unit.putRecord(BOARD_UNIT_TABLE, BOARD_DOCUMENT, legacyBoard);
	await unit.putRecord(BOARD_UNIT_TABLE, META_DOCUMENT, {
		schemaVersion: 2,
		legacyImported: imported,
		legacyProbedAt: now
	});
	documents = documentsOf(await unit.loadAll());
	if (!imported) return {
		unit,
		documents
	};
	const retired = await retire({
		unitName: BOARD_UNIT_NAME,
		legacyVersion: 1,
		migratedPath: join(unitDirectoryPath(BOARD_UNIT_NAME), BOARD_UNIT_TABLE, `${BOARD_DOCUMENT}.json`),
		now,
		log
	});
	if (retired.status === "retired") log(`[dsh-task-board] layout migration: legacy unit document moved to ${retired.retiredPath}`);
	return {
		unit,
		documents,
		retired
	};
}
/** Lease tuning: the client renews well inside the TTL; a dropped stream
*  shortens the holder's lease to the grace window. */
const LEASE_DEFAULT_TTL_MS = 2e4;
const LEASE_MIN_TTL_MS = 1e4;
const LEASE_MAX_TTL_MS = 6e4;
const LEASE_DISCONNECT_GRACE_MS = 5e3;
/**
* The host-side truth: documents + lease + relay. Every mutation to every
* document runs on ONE serialized write lane (the storage domain's
* single-write-chain discipline — the unit serializes nothing and says so),
* so commits from many replicas interleave in arrival order and each
* document's merge grammar resolves them. One lane, not one per document: the
* two disciplines it buys are "the merge runs against the newest in-memory
* document" and "one write in flight at a time", and both are pinned by tests.
*
* THE LEASE AND THE RELAY ARE UNIT-LEVEL ARBITRATIONS, not board facts, and
* they ride in this class because of the one thing they cannot route around:
* the backend gives a unit exactly one live handle, so everything that
* arbitrates or moves data in this unit has to be reachable from the one
* object holding it. Concretely — one engine drives time-based automation over
* BOTH documents, and a command relayed from a non-engine replica is executed
* by whichever replica holds the seat, whoever wrote the row. Reading the
* lease as "the board's lease" is the mistake this paragraph exists to
* prevent: it is the seat for the unit, and its state never mentions a
* document.
*/
/**
* The dedup key of a parked command: its carrier plus whatever it targets.
*
* This deliberately does NOT narrow on `command.type`, and does not know which
* carriers exist: it derives an IDENTITY, not a route. Narrowing here would put
* a list of carriers into the service, and a carrier added to the union later
* would need this file edited to keep its own commands from colliding. Reading
* whichever id the command carries keeps this correct for carriers that do not
* exist yet.
*/
function commandKeyOf(command) {
	return "taskId" in command ? `${command.type}:${command.taskId}` : `${command.type}:${command.sessionId}`;
}
var DocumentService = class {
	deps;
	doc = emptyBoardDoc(0);
	items = emptyItemsDoc(0);
	unit;
	lease;
	/** Live SSE connections per clientId. An open stream is the holder's
	*  liveness proof: unlike client timers it survives background-tab timer
	*  throttling, so the engine lease never flaps while its stream is up. */
	streams = /* @__PURE__ */ new Map();
	pendingCommands = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	lane = Promise.resolve();
	started = false;
	initPromise;
	disposed = false;
	/** Whether the board API serves synced documents (false = replica fallback). */
	available = false;
	now;
	log;
	/** When THIS host process started serving the board (carried on every lease
	*  answer). The board's stale-host dialog shows it: "我明明重启了它还这么
	* 显示" has exactly two answers — this process really is the old one, or the
	*  address is talking to a different instance — and a real clock reading
	*  settles it on the spot instead of leaving the user to guess. */
	bootedAt;
	constructor(deps = {}) {
		this.deps = deps;
		this.now = deps.now ?? (() => Date.now());
		this.log = deps.log ?? ((message, error) => error === void 0 ? console.error(message) : console.error(message, error));
		this.bootedAt = this.now();
	}
	/**
	* Open the persistence unit and load every document it holds, running the
	* one-time layout migration when the data root has never been written.
	* Failure to open or read leaves the service unavailable (replicas fall
	* back); a corrupt medium is normalized per document, never fatal.
	*/
	async init() {
		if (this.started) return;
		this.started = true;
		if (this.deps.openUnit === void 0) {
			this.log("[dsh-task-board] board storage unavailable: no persistence opener wired");
			return;
		}
		try {
			const opened = await openBoardUnit(this.deps.openUnit, this.now(), this.log);
			if (opened === void 0) {
				this.log("[dsh-task-board] board storage unavailable: no json backend on the storage hub");
				return;
			}
			this.unit = opened.unit;
			this.doc = normalizeBoardDoc(opened.documents[BOARD_DOCUMENT], this.now());
			this.items = normalizeItemsDoc(opened.documents[ITEMS_DOCUMENT], this.now());
			this.available = true;
		} catch (error) {
			this.unit = void 0;
			this.available = false;
			this.log("[dsh-task-board] board storage open failed; replicas fall back to local mode", error);
		}
	}
	/**
	* The one-started gate every route call passes through: the storage hub is
	* resolved lazily (the opener reads `ctx.get('storage')` at call time), so
	* the first browser request — always after boot settlement — initializes
	* the unit, and every later call rides the settled result.
	*/
	ensureInit() {
		this.initPromise ??= this.init();
		return this.initPromise;
	}
	/** The current authoritative document (detached reads are the caller's job). */
	getDoc() {
		return this.doc;
	}
	/** The current authoritative checklist — the second document, with its own
	*  revision and its own short-number counter (detached reads are the
	*  caller's job). */
	getItemsDoc() {
		return this.items;
	}
	/**
	* Apply one replica commit through the merge grammar. The write lane
	* serializes commits; persistence completes before the response resolves
	* (durability before ack). A no-op commit never persists nor broadcasts.
	* @returns the authoritative document after the commit.
	*/
	commit(commit) {
		return this.enqueue(async () => {
			const next = applyCommit(this.doc, commit, this.now());
			if (next === this.doc) return this.doc;
			if (this.unit !== void 0) await this.unit.putRecord(BOARD_UNIT_TABLE, BOARD_DOCUMENT, next);
			this.doc = next;
			this.broadcast({
				type: "commit",
				document: BOARD_DOCUMENT,
				revision: next.revision,
				clientId: commit.clientId
			});
			return next;
		});
	}
	/**
	* Apply one replica commit to the CHECKLIST through its own merge grammar —
	* the same lane, the same durability-before-ack order, the same no-op rule,
	* and its own document file. A checklist change does not touch the board's
	* revision or the board's record: two documents, two revisions, and one
	* write lane.
	*
	* IT BROADCASTS, under the document's own name. A `commit` frame carries the
	* document it moved and the consumer routes on that (`host-sync.ts` sends an
	* `items` frame to the checklist replica and leaves the board asleep), so
	* announcing a checklist write wakes exactly the replica that needs it and
	* nobody else. Without the frame, a note written on one device is invisible
	* everywhere else until some unrelated change happens to resync — which is
	* the same fact stated the other way round: the write was durable and
	* durable-before-ack, only the announcement was missing.
	* @returns the authoritative checklist after the commit.
	*/
	commitItems(commit) {
		return this.enqueue(async () => {
			const next = applyItemsCommit(this.items, commit, this.now());
			if (next === this.items) return this.items;
			if (this.unit !== void 0) await this.unit.putRecord(BOARD_UNIT_TABLE, ITEMS_DOCUMENT, next);
			this.items = next;
			this.broadcast({
				type: "commit",
				document: ITEMS_DOCUMENT,
				revision: next.revision,
				clientId: commit.clientId
			});
			return next;
		});
	}
	/**
	* Bring one deleted checklist row back, by identity or by short number.
	*
	* WHY THIS IS A SERVICE OPERATION AND NOT A CLIENT COMMIT. A tombstone is
	* stamped one millisecond ABOVE the row it removed, so re-submitting that row
	* untouched is exactly the stale copy the tombstone exists to swallow: the
	* commit would be accepted, nothing would change, and the caller would be
	* told it worked. Only the host knows the stamp, so only the host can write
	* the one value that has to be greater — {@link restoredItemOf} does that and
	* nothing else, and the row then rides the ordinary commit path, so restore
	* is a put like any other and needs no second merge rule.
	*
	* THE TWO ADDRESSES DIFFER ONLY IN HOW THE ROW IS FOUND, never in what is
	* written. By `id` there is no lookup at all: the tombstones are keyed by
	* identity, so the caller's uuid IS the key — which is what makes a row that
	* the document has not numbered yet (`ref === 0`) restorable at all, and an
	* undo gesture cannot know a number nobody has been shown. By `ref` the number
	* is a NAME, so it has to be looked up among the deletions first. Both end in
	* the same {@link restoredItemOf}, so the stamp that beats the tombstone is
	* written by one piece of code.
	*
	* An address that matches no tombstone is `undefined`, never a silent
	* success: the row is either still in the document (nothing to do), never
	* numbered, or past the tombstone's life — and in all three cases "restoring"
	* it would be a second row with a second number.
	*
	* @param of - which row, named by identity or by short number.
	* @param clientId - who asked, for the broadcast and the activity note.
	* @returns the restored row, or `undefined` when no tombstone holds that row.
	*/
	async restoreItem(of, clientId) {
		const id = of.kind === "id" ? of.id : deletedItemsOf(this.items).find((item) => item.ref === of.ref)?.id;
		if (id === void 0) return void 0;
		const restored = restoredItemOf(this.items, id, this.now());
		if (restored === void 0) return void 0;
		await this.commitItems({
			clientId,
			items: [restored],
			changed: [restored.id],
			deleted: []
		});
		return restored;
	}
	/**
	* Acquire or renew the engine lease. Liveness is the leaseState view (an
	* open SSE stream or any board API call keeps the holder alive); a free or
	* expired lease is granted to the caller.
	*
	* VISIBILITY PREEMPTION: every request carries `active` (the tab is
	* visible). A VISIBLE requester takes the seat from an INACTIVE holder —
	* the engine must sit where the user is looking, or native-turn recording
	* and dispatch stall on a frozen background tab (the "手机点开始没反应、
	* 电脑端才动" class). Two visible replicas never flip-flop: first-held
	* keeps the seat while it renews; an all-hidden fleet keeps the last holder
	* (scheduled automation survives nobody-looking).
	*/
	acquireLease(clientId, ttlMs, active = true) {
		const now = this.now();
		const ttl = clampLeaseTtl(ttlMs);
		const current = this.leaseState(now);
		if (current.held && current.holder !== clientId) {
			const holderLease = this.lease;
			const holderActive = holderLease !== void 0 && holderLease.clientId === current.holder ? holderLease.active : true;
			if (!(active && holderActive === false)) return {
				...current,
				held: false
			};
			this.lease = {
				clientId,
				expiresAt: now + ttl,
				ttl,
				active,
				lastTouchAt: now
			};
			this.broadcast({
				type: "lease",
				holder: clientId,
				expiresAt: this.lease.expiresAt
			});
			this.drainPendingCommands();
			return this.leaseState(this.now());
		}
		const renewing = current.held && current.holder === clientId;
		this.lease = {
			clientId,
			expiresAt: now + ttl,
			ttl,
			active,
			lastTouchAt: now
		};
		if (!renewing) this.broadcast({
			type: "lease",
			holder: clientId,
			expiresAt: this.lease.expiresAt
		});
		this.drainPendingCommands();
		return this.leaseState(this.now());
	}
	/** Voluntary release (page teardown): frees the seat immediately. */
	releaseLease(clientId) {
		if (this.lease?.clientId === clientId) {
			this.lease = void 0;
			this.broadcast({
				type: "lease",
				holder: void 0,
				expiresAt: void 0
			});
		}
		return this.leaseState(this.now());
	}
	/** Any API touch from the holder renews the lease for its granted TTL
	*  (throttle-proof: every commit/get/lease call refreshes the seat). */
	noteActivity(clientId) {
		if (clientId === void 0 || this.lease === void 0 || this.lease.clientId !== clientId) return;
		const now = this.now();
		this.lease = {
			...this.lease,
			expiresAt: now + this.lease.ttl,
			lastTouchAt: now
		};
	}
	/** An SSE connection dropped: retire its count; when the holder's last
	*  stream goes, shorten its lease to the grace window (a reload reopens the
	*  stream and keeps the seat; a closed tab yields it fast). */
	noteDisconnect(clientId) {
		if (clientId === void 0 || clientId === "") return;
		const live = (this.streams.get(clientId) ?? 0) - 1;
		if (live > 0) this.streams.set(clientId, live);
		else this.streams.delete(clientId);
		if (this.lease === void 0 || this.lease.clientId !== clientId) return;
		const graceUntil = this.now() + LEASE_DISCONNECT_GRACE_MS;
		if (this.lease.expiresAt > graceUntil) this.lease = {
			...this.lease,
			expiresAt: graceUntil
		};
	}
	/** The current lease state. A holder with a live SSE stream never expires
	*  (the stream is refreshed by the keep-alive writes; a dead one surfaces
	*  through noteDisconnect); an expired lease reads as free, holderless.
	*
	*  THE one construction site of a LeaseState: every lease answer the route
	*  can ever send (granted / renewing / rejected / released) is derived from
	*  this object, so no branch can ship a seat view that forgets `proto` or
	*  `bootedAt`. A missing `proto` read as "old host", which made the
	*  "服务端未重启" banner stand forever on every non-engine device — the
	*  rejected branch used to hand-build `{ held, holder, expiresAt }` and
	*  nothing else. */
	leaseState(now = this.now()) {
		if (this.lease === void 0) return {
			held: false,
			holder: void 0,
			expiresAt: void 0,
			proto: 2,
			bootedAt: this.bootedAt
		};
		if ((this.streams.get(this.lease.clientId) ?? 0) > 0 && this.lease.lastTouchAt + 8e4 > now) {
			if (this.lease.expiresAt < now + this.lease.ttl) this.lease = {
				...this.lease,
				expiresAt: now + this.lease.ttl
			};
			return {
				held: true,
				holder: this.lease.clientId,
				expiresAt: this.lease.expiresAt,
				proto: 2,
				bootedAt: this.bootedAt
			};
		}
		if (this.lease.expiresAt <= now) return {
			held: false,
			holder: void 0,
			expiresAt: void 0,
			proto: 2,
			bootedAt: this.bootedAt
		};
		return {
			held: true,
			holder: this.lease.clientId,
			expiresAt: this.lease.expiresAt,
			proto: 2,
			bootedAt: this.bootedAt
		};
	}
	/** An SSE connection for `clientId` opened (route layer, stream accepted). */
	noteStreamOpen(clientId) {
		if (clientId === void 0 || clientId === "") return;
		this.streams.set(clientId, (this.streams.get(clientId) ?? 0) + 1);
	}
	/**
	* Relay one user-initiated launch to the engine. With a live engine the
	* command broadcasts immediately; otherwise it parks (newest per task) and
	* replays when the next lease is granted.
	*/
	submitCommand(command) {
		const now = this.now();
		if (!this.leaseState(now).held) {
			this.parkCommand(command);
			return { queued: true };
		}
		this.broadcast({
			type: "command",
			command
		});
		return { queued: false };
	}
	/** Subscribe to board events (the SSE layer). @returns the disposer. */
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** Drain the unit and stop serving. */
	async dispose() {
		this.disposed = true;
		this.listeners.clear();
		const unit = this.unit;
		this.unit = void 0;
		this.available = false;
		if (unit !== void 0) try {
			await unit.close();
		} catch (error) {
			this.log("[dsh-task-board] board storage close failed", error);
		}
	}
	parkCommand(command) {
		if (this.pendingCommands.size >= 20) {
			const oldest = this.pendingCommands.keys().next();
			if (!oldest.done) this.pendingCommands.delete(oldest.value);
		}
		this.pendingCommands.set(commandKeyOf(command), command);
	}
	drainPendingCommands() {
		if (this.pendingCommands.size === 0) return;
		const commands = [...this.pendingCommands.values()];
		this.pendingCommands.clear();
		for (const command of commands) this.broadcast({
			type: "command",
			command
		});
	}
	broadcast(event) {
		if (this.disposed) return;
		for (const listener of [...this.listeners]) try {
			listener(event);
		} catch (error) {
			this.log("[dsh-task-board] board event listener failed", error);
		}
	}
	enqueue(task) {
		const run = this.lane.then(task);
		this.lane = run.then(() => void 0, () => void 0);
		return run;
	}
};
/** Clamp the requested TTL into the safe band. */
function clampLeaseTtl(ttlMs) {
	if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs)) return LEASE_DEFAULT_TTL_MS;
	return Math.min(LEASE_MAX_TTL_MS, Math.max(LEASE_MIN_TTL_MS, Math.floor(ttlMs)));
}
const BOARD_SERVICE_REGISTRY_KEY = "__dshTaskBoardUnits";
function boardServiceRegistry() {
	const scope = globalThis;
	const existing = scope[BOARD_SERVICE_REGISTRY_KEY];
	if (existing instanceof Map) return existing;
	const fresh = /* @__PURE__ */ new Map();
	scope[BOARD_SERVICE_REGISTRY_KEY] = fresh;
	return fresh;
}
function releaseOf(registry, handle) {
	let released = false;
	return () => {
		if (released) return;
		released = true;
		handle.owners -= 1;
		if (handle.owners > 0) return;
		if (registry.get("dsh_task_board") === handle) registry.delete(BOARD_UNIT_NAME);
		handle.service.dispose();
	};
}
/**
* Borrow the process's one DocumentService for the board unit.
*
* The first acquirer creates it and kicks off init; later acquirers share it,
* so the routes and the model tools always read and write through the same
* handle, the same lease and the same write lane. Each `release` gives up one
* ownership; the last one closes the unit — unloading the agent row never
* starves the board row, and unloading the board row never strands the tools.
* @param openUnit - the hub opener, used only by the acquisition that creates.
* @returns the shared service plus the one ownership this caller must release.
*/
function acquireBoardService(openUnit) {
	const registry = boardServiceRegistry();
	const held = registry.get(BOARD_UNIT_NAME);
	if (held !== void 0) {
		held.owners += 1;
		return {
			service: held.service,
			release: releaseOf(registry, held)
		};
	}
	const service = new DocumentService({ openUnit });
	service.ensureInit();
	const handle = {
		service,
		owners: 1
	};
	registry.set(BOARD_UNIT_NAME, handle);
	return {
		service,
		release: releaseOf(registry, handle)
	};
}
/**
* Wire the service onto the platform storage hub: resolve `ctx.storage` at
* open time (boot settlement has passed by the first browser request), take
* the `json` backend's KV facet, and open the unit the descriptor names. A
* missing hub or backend yields undefined (the service then reports
* unavailable — fallback mode, never a throw).
*/
function storageHubOpener(storage) {
	return async (descriptor) => {
		const kv = (storage()?.backend?.get?.("json"))?.kv;
		if (kv?.open === void 0) return void 0;
		return kv.open(descriptor);
	};
}
//#endregion
//#region src/host/agent/commands.ts
/**
* The two slash commands (host half): `/task` and `/task-continue`.
*
* ── WHAT A COMMAND IS NOT ──────────────────────────────────────────────────
*
* A command here is a DOOR, not a pipeline. It takes what the person typed and
* hands that sentence to the model **in the session they were already talking
* in** — no fixed pipeline, no pre-filled input box, no second copy of the
* conversation. The whole reason this works is that the conversation history
* is already in that session: a model asked to "write down the three things we
* just discussed" can see them without this plugin relaying a single one.
*
* So the handler does exactly three things: take the words, hand them over,
* say nothing. Anything smarter here would be a workflow the model has to
* fight, and a workflow that has to be kept in step with the board is a second
* set of rules — which is the thing this whole project is removing.
*
* `recordInput: false`: the sentence is already a message in this session, so
* recording it again as the command's own input would put the same words in the
* log twice. It is a payload someone else owns.
*
* `/task-continue` differs in exactly one way: it is a prompt, not a blank
* door. The model is asked to read the outstanding items and ask where to
* start, because "continue" without knowing what is outstanding is a guess.
*/
/** `/task` with no argument has nothing to hand over, and a blank door is a
*  worse experience than being told what the command is for. */
const TASK_HINT = "用法：/task 后面直接写你要记的事，例如「/task 把刚才说的三件事记下来」。我不会替你猜——你原话是什么，我就把什么交给这个会话里的模型。";
/** `/task-continue` carries no argument by design: "continue" is a question
*  about what is outstanding, and an argument would only narrow it wrongly. */
const CONTINUE_PROMPT = "读一下任务清单里还没完成的事项，把它们列出来，然后问我要从哪一条开始。不要替我挑。";
/**
* Hand one sentence to a session's model.
*
* THE ONE PATH from this plugin into a model. Both slash commands call it, and
* so does the panel's one-click hand-off (`/board/ask`), because the reader is
* asking for the same thing in two places: one `followup`, one message shape,
* one failure story. A second copy of these four lines is a second thing to keep
* in step, and the day they drift is the day one of the two paths quietly
* stops saying what it says.
*
* Success carries no `text` on purpose: the model answers in the conversation
* right after this, in its own words and with its own tool cards, and a text
* here would put a second, weaker rendering of the same turn in front of the
* person.
*/
function handOver(agent, text) {
	try {
		agent.followup(createUserMessage({
			content: [{
				type: "text",
				text
			}],
			source: { kind: "user" }
		}));
		return { kind: "success" };
	} catch (error) {
		return {
			kind: "error",
			text: `这句话没能送进会话：${error instanceof Error ? error.message : String(error)}`
		};
	}
}
/** The two command definitions, ready to register. */
function createTaskboardCommands() {
	return [{
		name: "task",
		description: "把这句话交给当前会话的模型（它看得到这轮对话的上下文）",
		recordInput: false,
		handler: ({ agent, rawInput }) => {
			const text = rawInput.trim();
			if (text === "") return {
				kind: "error",
				text: TASK_HINT
			};
			return handOver(agent, text);
		}
	}, {
		name: "task-continue",
		description: "让模型读出清单里未完成的事项，并问你从哪一条开始",
		recordInput: false,
		handler: ({ agent }) => handOver(agent, CONTINUE_PROMPT)
	}];
}
/** Register both, and return one disposer that takes them both off. */
function registerTaskboardCommands(registry) {
	const disposers = createTaskboardCommands().map((definition) => registry.register(definition));
	return () => {
		for (const dispose of disposers) dispose();
	};
}
//#endregion
//#region src/host/session-state.ts
/** A seen answer. */
function seen(value) {
	return { value };
}
/** An answer the host could not reach, and why. */
function blind(why) {
	return {
		value: "unknown",
		unreadable: why
	};
}
/**
* `agent.status` is the native lifecycle word and nothing else decides it.
* A session the host has no agent for is not a session that is idle: it is a
* session this host cannot see, and the answer says so.
*/
function sessionRunningOf(sources, sessionId) {
	const { face: agents, why } = read(sources.agents, "ctx.agents");
	if (agents === void 0) return blind(why ?? "no agents service on this host");
	let agent;
	try {
		agent = agents.get(sessionId);
	} catch (error) {
		return blind(`agents.get threw: ${describe(error)}`);
	}
	if (agent === void 0) return blind(`no live agent for session ${sessionId}`);
	const status = agent.status;
	if (status !== "idle" && status !== "running") return blind(`unknown agent status ${describe(status)}`);
	return seen(status === "running");
}
/** Archive membership, read from the registry's own field — never inferred
*  from workspace membership, which is a different question. */
function sessionArchivedOf(sources, sessionId) {
	const { face: registry, why } = read(sources.workspaceRegistry, "ctx.workspaceRegistry");
	if (registry === void 0) return blind(why ?? "no workspaceRegistry on this host");
	const archived = registry.archivedSessionIds;
	if (!Array.isArray(archived)) return blind("workspaceRegistry carries no archivedSessionIds");
	return seen(archived.includes(sessionId));
}
/**
* THE PAIRING LAW: an `approval/asked` is waiting until an `approval/decided`
* carrying the SAME `id` exists. The host's contract appends exactly one
* decision per ask, so the difference of two id sets is the whole answer —
* and pairing by id rather than by position means a log whose order surprises
* us still answers correctly.
*
* Events whose shape we do not recognize are SKIPPED, never counted as a
* decision: a malformed record must not be able to fake a settled approval.
*/
function awaitingApprovalIn(events) {
	const asked = /* @__PURE__ */ new Set();
	const decided = /* @__PURE__ */ new Set();
	for (const raw of events) {
		if (typeof raw !== "object" || raw === null) continue;
		const event = raw;
		const id = event.data?.id;
		if (typeof id !== "string" || id === "") continue;
		if (event.type === "approval/asked") asked.add(id);
		else if (event.type === "approval/decided") decided.add(id);
	}
	for (const id of asked) if (!decided.has(id)) return true;
	return false;
}
/** The durable half: replay the session log and look for an unpaired ask. */
async function awaitingApprovalOf(sources, sessionId) {
	const { face: query, why } = read(sources.sessionQuery, "ctx.sessionQuery");
	if (query === void 0) return blind(why ?? "no sessionQuery on this host");
	let snapshot;
	try {
		snapshot = await query.readSession(sessionId);
	} catch (error) {
		return blind(`session log unreadable: ${describe(error)}`);
	}
	const events = snapshot?.events;
	if (!Array.isArray(events)) return blind("session log carries no event list");
	return seen(awaitingApprovalIn(events));
}
function createQuestionWaitRecorder() {
	const open = /* @__PURE__ */ new Map();
	let observed = false;
	return {
		noteAsk(sessionId) {
			observed = true;
			open.set(sessionId, (open.get(sessionId) ?? 0) + 1);
		},
		noteSettled(sessionId) {
			const next = (open.get(sessionId) ?? 0) - 1;
			if (next > 0) open.set(sessionId, next);
			else open.delete(sessionId);
		},
		awaitingOf(sessionId) {
			return (open.get(sessionId) ?? 0) > 0;
		},
		get observed() {
			return observed;
		},
		dispose() {
			open.clear();
		}
	};
}
/** The session id off a question request, when the payload carries one. */
function sessionIdOfRequest(request) {
	if (typeof request !== "object" || request === null) return void 0;
	const id = request.agent?.session?.id;
	return typeof id === "string" && id !== "" ? id : void 0;
}
/**
* Observe the question waterfall without ever claiming it.
*
* The listener brackets the dispatch: it marks the session waiting, delegates
* through `next()`, and unmarks in a `finally` so a thrown or cancelled answer
* releases the window too. It NEVER returns a value of its own — a bypass that
* claimed would silently steal every question from the human's own card.
*
* @returns the disposer removing the listener.
*/
function attachQuestionWaitRecorder(target, recorder) {
	const listener = (request, next) => {
		const sessionId = sessionIdOfRequest(request);
		if (sessionId !== void 0) recorder.noteAsk(sessionId);
		return Promise.resolve(next()).finally(() => {
			if (sessionId !== void 0) recorder.noteSettled(sessionId);
		});
	};
	const dispose = target.on("user-questions/request", listener);
	return typeof dispose === "function" ? dispose : () => void 0;
}
/**
* The in-flight half, and the honest part: a recorder that has never observed
* a dispatch has NOT told us nobody is waiting — it has told us this host was
* not looking. Those are different claims, and the second one must never be
* dressed as the first.
*/
function awaitingAnswerOf(recorder, sessionId) {
	if (recorder === void 0) return blind("no question bypass attached on this host");
	if (!recorder.observed) return blind("the question bypass has not seen a dispatch yet");
	return seen(recorder.awaitingOf(sessionId));
}
/**
* All four answers for one session, read fresh. A caller that wants three of
* them cannot accidentally use a different rule for one.
*/
async function sessionPostureOf(sources, recorder, sessionId) {
	return {
		sessionId,
		running: sessionRunningOf(sources, sessionId),
		archived: sessionArchivedOf(sources, sessionId),
		awaitingApproval: await awaitingApprovalOf(sources, sessionId),
		awaitingAnswer: awaitingAnswerOf(recorder, sessionId)
	};
}
/** One optional face, or the reason it could not be resolved. A getter that
*  throws degrades to "absent" with its reason — resolving a service must
*  never be the thing that takes a reader down. */
function read(thunk, what) {
	if (thunk === void 0) return {
		face: void 0,
		why: `no ${what} wired on this host`
	};
	try {
		return { face: thunk() };
	} catch (error) {
		return {
			face: void 0,
			why: `${what} could not be resolved: ${describe(error)}`
		};
	}
}
/** A one-line description of an unknown value, for the `unreadable` reason. */
function describe(value) {
	if (value instanceof Error) return value.message;
	if (typeof value === "string") return value;
	return typeof value;
}
//#endregion
export { itemInstantOf as A, withStatus as C, ITEM_PRIORITIES as D, restoredItemOf as E, itemTagsOf as M, itemTitleOf as N, ITEM_STATUSES as O, newItem as P, withSchedule as S, deletedItemsOf as T, createTask as _, handOver as a, ruleArmingBlocked as b, storageHubOpener as c, isValidCron as d, nextRunAtMs as f, MANUAL_STATUSES as g, relatedSessionIdsOf as h, sessionRunningOf as i, itemStatusOf as j, itemDateConflict as k, clampCruiseLimit as l, leaveRunningTargetOf as m, createQuestionWaitRecorder as n, registerTaskboardCommands as o, RUN_CONFIG_KEYS as p, sessionPostureOf as r, acquireBoardService as s, attachQuestionWaitRecorder as t, disarmSessionRules as u, disarmSchedule as v, applyItemsCommit as w, taskBindsOf as x, isOpenRound as y };
