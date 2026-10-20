/**
 * The checklist's transitions — the one implementation the interface and the
 * model both go through, so one intent cannot land as two different rows.
 *
 * WHY THIS FILE HAD TO EXIST, STATED AS THE BUG IT ENDS. A checklist row used
 * to be written in two places: the panel went through `client/item/model.ts`
 * (a field patch, a step toggle, a delete, a capture) and the model went
 * through six `item.*` branches inside the tool. Each was individually
 * reasonable and each was correct on the day it was written. Then they drifted,
 * in the two ways two copies of a write path always drift:
 *
 *  - **THE NO-OP LAW WAS WRITTEN TWICE, AND ONE COPY FORGOT IT.** The panel
 *    compared the row it built with the row it had; the tool compared eleven
 *    fields by hand and compared the steps through `JSON.stringify`. An edit
 *    that changes nothing must return the SAME array, because the sync replica
 *    only stamps a revision and wakes every device when it is handed a
 *    different one. The day the two comparisons drifted apart, the same
 *    keystroke burned a revision on one device and not on another, and the
 *    document's history grew a change that had never happened.
 *  - **THE STEP IDS WERE TWO SCHEMES.** The capture box minted
 *    `step-<index>-<clock>`; the tool minted a uuid. Neither is wrong alone,
 *    but a row's checklist is addressed BY those ids, so the same words typed
 *    into two surfaces produced two different lists — and `item.step` is an
 *    action precisely because ticking one box must not rebuild the list.
 *
 * The checklist is the SECOND document this plugin syncs, which is what makes
 * the drift expensive rather than merely untidy: two devices holding one
 * document must show one list, and a document whose order of writing differs
 * per writer is a document whose two replicas can disagree about facts nobody
 * ever typed.
 *
 * WHAT "PURE" MEANS HERE, precisely (the tests scan for it, because a pure
 * function that quietly reads the clock is not pure, it is just untested until
 * someone runs it twice):
 * - no controller, no `ctx`, no store, no module singleton, no `Date.now()`;
 * - the instant comes in as an argument and the identity comes in as a minter,
 *   so a second call with the same input is the same output;
 * - a refusal is a VALUE wherever one is possible, and where it is not (a row
 *   that is simply not there) the answer is the input itself, unchanged.
 *
 * AND WHEN NOTHING MOVES, THE SAME ARRAY COMES BACK. This is the law the
 * client's `editItem` already kept and the reason it is written down here: the
 * caller compares the returned array to the one it passed in, and identity IS
 * the answer. A function that returned a fresh equal array would be correct and
 * useless, because every no-op keystroke would broadcast to every device for a
 * change that did not happen.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT JUDGE ────────────────────────────
 *
 * Three refusals live somewhere else on purpose, and each of them is somebody
 * else's named home:
 *
 *  - **WHICH FIELDS MAY BE WRITTEN AT ALL** is {@link ITEM_FIELDS}' ruling, and
 *    the patch type below is DERIVED from it, so the gate is the compiler's:
 *    a field ruled `derived` or `forbidden` cannot appear in an {@link
 *    ItemPatch} without failing the build. The short number, the provenance and
 *    the birth stamp are the document's to hand out and the audit trail's to
 *    keep; this module is not a second opinion about any of them.
 *  - **WHETHER A ROW IS WORTH WRITING** is {@link isBlankCapture}'s rule, and it
 *    is here rather than in the editor because two places have to read it — the
 *    composer's disabled button and the save path — and a button that is enabled
 *    for input the save refuses is a gesture that appears to work and does
 *    nothing. The REFUSAL itself still belongs to the editor, because refusing
 *    has to KEEP THE READER'S WORDS, and that is a fact about the text box
 *    rather than about the document.
 *  - **WHETHER THE THREE DATES CAN ALL BE TRUE** is reported, not repaired
 *    (`itemDateConflict`). A write path that quietly reordered a reader's three
 *    dates and reported success is worse than one that leaves them visible, so
 *    the three fields are carried exactly as given and the surfaces say which
 *    pair disagrees.
 */
import type { ItemOriginSource, ItemRecord, ItemStep } from './item.ts';
import { ITEM_FIELDS } from './item.ts';
import type { ItemCardLink } from './item-membership.ts';
import { type AttachmentRef } from './attachment.ts';
import { type TaskStatus } from './tasks.ts';
/**
 * The keys a patch may carry, DERIVED from the ruling table instead of being
 * written out beside it. A second list of "the fields you may patch" is a list
 * that stops agreeing with `ITEM_FIELDS` the first time somebody rules a new
 * field `forbidden`, and the failure is invisible: the field is accepted, stored
 * and merged, and the document now carries a second opinion about something it
 * promised nobody else could write. So the type asks the table.
 */
export type WritableItemKey = {
    [K in keyof ItemRecord]: (typeof ITEM_FIELDS)[K]['access'] extends 'writable' ? K : never;
}[keyof ItemRecord];
/**
 * A mutation, expressed as a partial row.
 *
 * AN ABSENT KEY MEANS "LEAVE IT ALONE", NEVER "CLEAR IT" — and an absent key is
 * distinguishable from an explicit `undefined`, because the patch is SPREAD: a
 * date field the reader emptied arrives as `{ dueAt: undefined }` and does clear
 * the promise, while a patch that never mentions `dueAt` keeps it. That is the
 * whole reading rule for this type, and it is why the fields are not optional
 * wrappers.
 *
 * ── `undefined` IS ONLY A CLEARING FOR A FIELD THAT IS CLEARABLE ─────────────
 *
 * 「日期字段的 `undefined` = 清空」**只对可空的字段成立**（日期那几项的行内形状
 * 本来就是 `number | undefined`）。**必填字段（标题、正文、备注、标签、步骤）的
 * `undefined` 是非法值**，因为它会把那一行变成**不合形状的行**：`title: undefined`
 * 过不了 `isItemRecordShape`（它要 `typeof row.title === 'string'`），于是
 * **整行被文档文法丢掉**——而调用方还以为自己写成功了。
 *
 * **这一条曾经写错在这里**：注释说的是「显式的 `undefined` 会清空」，而实现里
 * 那不是清空，是**把 `undefined` 写进行上**。模型那条路（`src/host/agent/tools.ts`）
 * 把「没传的字段」统统写成 `undefined`，于是「改一个标题」会把**整行**改没，
 * 回执却写着「已生效」。
 *
 * **两处一起修才是根因级的修法**：① 造补丁的地方**只写它真的有的字段**
 * （`host/agent/tools.ts` 现在这样做了）；② 共享写入器**不许写出不合形状的行**
 * （`applyItemPatch` 在写之前过一遍形状门）——一处是修那个调用点，一处是让**这一类
 * 写坏行**在任何调用点都写不出去。
 *
 * The one thing a patch can never carry is a field the model ruled
 * `derived` or `forbidden`: see {@link WritableItemKey}.
 */
export type ItemPatch = Partial<Pick<ItemRecord, WritableItemKey>>;
export declare const REFUSED_BY_THE_RULING_TABLE: ItemPatch;
/**
 * Apply one edit to one row.
 *
 * The rule this function exists to make un-skippable: **an edit that changes
 * nothing returns the very same array**, so the caller's "did I move anything"
 * test is an identity check and a no-op never reaches the replica. The stamp
 * moves ONLY with a real change, which is the other half of the same promise —
 * a row that was touched without being edited must not read as "刚刚" on every
 * device's screen at once.
 *
 * @param items - the current list, in document order.
 * @param id - the row to change, by identity. A row that is not there is not
 *   an error here: the document owns finding rows, and this function's whole
 *   contract is "change this one, or change nothing".
 * @param patch - the fields to change; absent keys are left alone.
 * @param now - the edit clock, passed in and never read from the machine.
 * @returns the next list, or THE SAME LIST when the edit would change nothing.
 */
export declare function applyItemPatch(items: readonly ItemRecord[], id: string, patch: ItemPatch, now: number): readonly ItemRecord[];
/**
 * Set one step of one row, creating nothing.
 *
 * TWO LAWS, BOTH ABOUT WHAT MUST NOT HAPPEN. Only that one entry moves: the
 * list is copied and one slot is replaced, never rebuilt from a caller's
 * memory, because `item.update` replaces the WHOLE list by design and a writer
 * retyping steps it half-remembers is how a checklist quietly loses a line. And
 * a step already in the requested state is not a write at all — the same array
 * comes back, so a retry does not burn a revision.
 *
 * Steps are one level by model decision, so there is no recursion here and none
 * may be added: a nested checklist is the thing a narrow column cannot show and
 * the design rules refuse to show.
 *
 * @param items - the current list.
 * @param id - the row to change.
 * @param stepId - the step to set. An id that names nothing is a QUESTION, not
 *   a silent success — the step list is something only the document knows, so
 *   the caller has to read it (see the tool, which answers with the list).
 * @param done - the state to set, not a toggle. "Tick or untick" is a decision
 *   the caller can make from a value it has already read; a toggle would make
 *   two devices that both retried land on opposite sides of one box.
 * @param now - the edit clock.
 * @returns the next list, or the very same one when nothing changed.
 */
export declare function applyItemStep(items: readonly ItemRecord[], id: string, stepId: string, done: boolean, now: number): readonly ItemRecord[];
/**
 * Take one row out of the list.
 *
 * This is the LIST half and nothing else: the tombstone that makes the deletion
 * reversible, recoverable and un-resurrectable by a stale replica belongs to
 * the merge grammar (`items-doc.ts` feeding `board-merge-core.ts`), because that
 * arithmetic is shared by every document in this plugin and re-deriving it here
 * would be a second tombstone rule. What this function owns is the promise the
 * panel prints in front of the reader — the row is GONE from the list, and
 * "gone from the list" is a different fact from "erased".
 *
 * @param items - the current list.
 * @param id - the row to drop.
 * @returns a new list without it, or the very same list when it was not there.
 */
export declare function removeItemRecord(items: readonly ItemRecord[], id: string): readonly ItemRecord[];
/**
 * Put a row the host has just restored back into the list, where it was.
 *
 * WHY THIS EXISTS, and the failure it ends. Undo is the one gesture on this
 * surface that a reader presses AFTER the thing they want has already left the
 * screen. Every other write is followed by an optimistic local update, so the row
 * is already there when the host agrees; an undo had no local update, because
 * there was nothing to optimistically write — the host had to go and fetch the
 * row back out from behind a tombstone first. So the code waited for the host's
 * broadcast to bring it home, and if that broadcast was late, coalesced, or lost
 * the reader had pressed 撤销 and watched nothing happen at all. **A button whose
 * only effect is a message about a change you cannot see is the definition of a
 * dead control**, and it is the control that is most expensive to be dead on,
 * because the reader has just destroyed something and is relying on this.
 *
 * So the restore is written locally the moment the host confirms it — by
 * IDENTITY and not by append, because the row keeps its own place in the
 * document's order and re-appending it would move it to the end of the list,
 * which is a second, subtler way of telling the reader their notes were
 * reorganised.
 *
 * @param items - the current list.
 * @param restored - the row the host handed back.
 * @returns a new list with that row in its own place, or the very same list when
 *   the document already has it.
 */
export declare function restoreItemRecord(items: readonly ItemRecord[], restored: ItemRecord): readonly ItemRecord[];
/**
 * The card a promotion would create, said as words.
 *
 * Nothing else. The card's identity is minted by whoever writes the ledger, the
 * column it opens in is `createTask`'s own default, and the LINK back to the row
 * is a second write the caller makes after this one — so a plan is the three
 * fields that are decided by the row itself, and a caller cannot get them wrong
 * by forgetting one.
 */
export interface ItemPromotionTask {
    /** The card's title: the override, else the row's title (which borrows the body's first line). */
    readonly title: string;
    /** The card's description: the row's context notes, which is what they are FOR. */
    readonly description: string;
    /** The execution prompt: the override, else the row's body. */
    readonly prompt: string;
    /**
     * 这一条正文带的图片与文件，跟卡一起走。
     *
     * **它们是这一条自己的内容**，不是卡上另挂一份：把「正文 + 附件」拆成两半交给两个对象，
     * 就出现「卡上看得见正文、看不见那张图」——而读者在清单里明明把图给了这一条。所以提升
     * 把附件原样交给新卡（ref 指的是同一份字节，没有第二份拷贝）。
     */
    readonly attachments: readonly AttachmentRef[];
    /**
     * 这张卡出生在哪一栏：**这一条自己现在的状态**（执行器才能给的那两档落到「待办」）。
     *
     * 不许写死 `'todo'`：它不看这一条当时的真实状态，于是「先标已完成、再挂卡」就变成
     * 两份互相矛盾的数据，而屏上没有一句话解释。真正会产卡的那一处（`planItemPromotion`）
     * 也照这一条读。
     */
    readonly status: TaskStatus;
}
/**
 * What a promotion decided: a card to create, or the reason it will not.
 *
 * A REFUSAL IS A CODE, NEVER A SENTENCE, and that is the whole reason this
 * function exists in the core rather than in either caller. The judgments have
 * to be shared (a button that promotes a row and a model action that promotes
 * the same row must agree about when it is allowed), and the WORDING must not
 * be: the interface speaks the reader's language and the tool speaks to a model
 * that has to be told what to fix. A shared function that returned a sentence
 * would force one of the two to ship a translation of the other, which is the
 * defect `items-archive.ts` already refused once (`why` is a code, the panel
 * owns the words).
 *
 * The two refusals carry exactly the data each has: `alreadyLinked` hands back
 * the card the row is already on, because "it is already promoted" is not a
 * useful thing to say to somebody who cannot then go and look at it.
 */
export type ItemPromotion = {
    readonly kind: 'ready';
    readonly task: ItemPromotionTask;
} | {
    readonly kind: 'refused';
    readonly why: 'alreadyLinked';
    readonly taskId: string;
} | {
    readonly kind: 'refused';
    readonly why: 'noTitle';
};
/** The words a caller may supply instead of the row's own. All three optional. */
export interface ItemPromotionOverrides {
    readonly cardTitle?: string;
    readonly cardPrompt?: string;
    /**
     * 「这张我要的那张卡还不存在——给我再开一张」，说给计划的第 1 条判定听。
     *
     * 不挂卡的那一条按「变成卡片」被拒，是同一条判定在**拦一次失误**：重复提升会
     * 让第二个名字指不定谁才是来处。而选择器里那枚「新建卡片」是**明知故犯**的一声
     * 「换一张新的」——同一个词，两件事；不把这份明说递进来，已经在卡上的那条就永远
     * 说不出口这一句。判定本身不动：拦住的本是没说这句话的调用。 */
    readonly another?: boolean;
}
/**
 * Decide whether one row may become a board card, and say what that card says.
 *
 * FOUR JUDGMENTS, IN THIS ORDER, AND THE ORDER IS THE POINT:
 *
 *  1. **A row already on a card is not promoted again — unless the caller said
 *     `another`.** Re-promoting would
 *     make a SECOND card and leave the row pointing at whichever one was written
 *     last, so the note would appear to belong to two things and the first card
 *     would have lost its origin. This is the state, reported — not performed.
 *     `another` is the caller's 「我知道，就是要一张新的」: a deliberate act and
 *     not a repeated press, so the guard stands aside.
 *  2. **A card with no name is refused.** {@link itemTitleOf} has already
 *     borrowed the body's first line for an untitled row, so reaching this branch
 *     means the row has no words at all; a card built out of nothing is a thing
 *     with no name, and the reader is asked for a sentence instead.
 *  3. **The three fields fall back to the row's own words** — title from the
 *     title, description from the NOTES (which exist to be handed to whoever
 *     picks this up, and a card is exactly that), prompt from the BODY (which
 *     is the work itself). An override replaces one field and never the other
 *     two, so overriding the title does not silently move the prompt.
 *
 * What is NOT here, on purpose: finding the row. A plan is handed a row, so
 * "there is no such row" is not a verdict this function could give — the absence
 * of a row is a LOOKUP failure, and it belongs to whoever did the lookup and has
 * a sentence for it. And the card is not created here: this returns the words,
 * and the caller writes the ledger and then the link, in that order, because a
 * half-finished promote that leaves the card without its link is
 * indistinguishable from "not promoted yet" (and the other order leaves the row
 * pointing at a card that does not exist — a state the interface would have to
 * render as a defect).
 *
 * @param item - the row being promoted.
 * @param over - words supplied instead of the row's own.
 * @returns the card to create, or the reason it will not be created.
 */
export declare function planItemPromotion(item: ItemRecord, over?: ItemPromotionOverrides): ItemPromotion;
/**
 * **一条链接，两个入口：挂上 / 改状态。**
 *
 * ── 为什么必须是 core 里的一对函数 ─────────────────────────────────────────
 *
 * `taskId` 这个字段**不许有六条互不知道对方的写入路径**（详情那一格点已有卡、提升、
 * 模型的提升、悬空自我归正、建卡时带链接），状态也不许有三张面两套接线。同一件事有六个入口，
 * 就是六套行为——读者看到的是「按了没反应」「两边不一样」这类没法解释的现象。所以：
 * **挂上、改状态各只有一个入口**，界面与将来的 AI 都走它。
 *
 * ── 那条已钉着的规则仍然成立 ───────────────────────────────────────────────
 *
 * `itemStatusOf` 的「读者自己按下的完成压过卡片」不动（有测试钉着：一张卡重跑起来的时候，
 * 刚被读者勾掉的那一行仍然是完成）。它带来的一件坏事是「写了一张牌却收不回来」——所以
 * **每一次改状态都把两边写成同一档**：按已完成 = 标这一行
 * **并且**把卡移过去；按别的 = 移卡 **并且**把那张牌收回。于是那张牌在屏上不是陷阱。
 */
/**
 * 这一条挂着的卡，**按这一侧看得见的栏读**——链接与那一栏一起。
 *
 * 两样东西必须一起给，因为「挂着的卡在哪一栏」是同一件事的两半：改状态要移那张卡（要它的
 * id），也要知道它现在在哪一栏（那一栏是「它还在进行中吗」这条门的判据）。分开给就是两处
 * 各记一半，而两半可以来自不同的读取——于是「这一条挂着的卡」有两个答案。
 */
export type { ItemCardLink } from './item-membership.ts';
export interface ItemStatusWrite {
    /** 写完之后的整份清单。 */
    readonly rows: ItemRecord[];
    /** 这一次要移的那张卡；没有卡就不是一次移卡。 */
    readonly move?: {
        readonly cardId: string;
        readonly status: TaskStatus;
    };
    /**
     * 写不上去的两种理由，**各带一个码**。
     *
     *  - `cardRunning`——那张卡还在进行中，这一轮没跑完，它现在归执行器管。清单这一侧改它
     *    的状态就是与执行器抢同一张卡：屏上那一行与那张卡会说出两个故事。
     *  - `executorOnly`——目标那一档由执行器落（进行中 / 待审核），人手给不了。
     */
    readonly refused?: 'cardRunning' | 'executorOnly';
}
/**
 * 改一条的状态，或说明为什么改不了。
 *
 * **两道门的次序是这里的一部分**：先问「那张卡还在进行中吗」，再问「这一档是不是人给的」。
 * 两者都成立时，调用点要说的话由先问的那一道决定——次序写在函数里，两边就拿到同一句话；
 * 写在调用点里，两个调用点各写一次就会有一个先问另一个后问。
 *
 * @param rows - 整份清单。
 * @param id - 哪一条。
 * @param status - 目标档（五档之一）。
 * @param card - 这一条挂着的卡与它所在的栏（`linkedCardOf` 的答案），没挂卡是 `undefined`。
 * @param now - 写入时钟。
 */
export declare function applyItemStatus(rows: readonly ItemRecord[], id: string, status: TaskStatus, card: ItemCardLink | undefined, now: number): ItemStatusWrite;
/**
 * 把一条挂到一张卡上：**链接与状态一起写**。
 *
 * 摘下（`{ taskId: undefined }`）不需要一个函数：这一行保留最后一次与卡同步过的状态，
 * 那就是它现在的状态（一次普通的补丁）。而挂上必须同时决定「这一行自己那一档是什么」，
 * 因为挂上之后显示那件事由卡回答——两个字段各写各的，就是这一轮修掉的那类账。
 *
 * **读者自己按下的「完成了」压过卡片**（`itemStatusOf` 的那一条唯一例外）：挂上去不改读者
 * 对这一行说过的话。面板那一支「卡换了栏，这一行自己那一档跟着写」也留着这一条例外，
 * 两边于是对同一行说出同一句话——挂上与换栏是同一条律的两个动作。
 *
 * @param rows - 整份清单。
 * @param id - 哪一条。
 * @param cardId - 挂到哪张卡。
 * @param cardStatus - 那张卡此刻在哪一栏（新卡的出生栏见 `planItemPromotion`）。
 * @param now - 写入时钟。
 */
export declare function mountItemRecord(rows: readonly ItemRecord[], id: string, cardId: string, cardStatus: TaskStatus, now: number): ItemRecord[];
/**
 * The id a step gets when a writer brought text and no id of its own.
 *
 * DETERMINISTIC, and that is the whole point: the same row and the same
 * position always produce the same id, so a `dry_run` rehearsal and the run
 * that follows it write the same checklist, and two writers who typed the same
 * lines into the same row end up with the same ids. The earlier schemes — an
 * index plus a clock on one side, a fresh uuid on the other — were each
 * irreproducible, and a step is ADDRESSED by this id: `item.step` takes it as a
 * parameter, so a scheme that changes per writer is a scheme whose ids cannot
 * be quoted.
 *
 * @param itemId - the row the step belongs to.
 * @param at - the step's 1-based position in the list.
 * @returns the step's identity.
 */
export declare function mintStepId(itemId: string, at: number): string;
/** A step list as it will be stored, and what had to be repaired to get there. */
export interface ItemStepList {
    readonly steps: ItemStep[];
    /** How many steps arrived without an id and were given one here. */
    readonly minted: number;
}
/**
 * Read a step list the way the document stores one: `{ id, text, done }`.
 *
 * A step without an `id` is DROPPED SILENTLY by the inbound row grammar, so a
 * writer that supplies three steps and gets one back would never know two of
 * them vanished — and a silently shortened checklist is a list that lies about
 * its own work. So every missing id is minted here, in order, and the count is
 * REPORTED to the caller, which can then say so out loud. An entry with no
 * readable text is dropped, because a step is a line of words and a blank
 * checkbox is not one; everything else is kept.
 *
 * `null` and an empty list both read as "the checklist is empty now", which is
 * the same law the three dates follow: passing an empty value CLEARS the
 * promise, and passing nothing at all leaves it alone.
 *
 * @param raw - what the writer supplied, in any shape.
 * @param itemId - the row the steps belong to, which is what their minted ids
 *   are derived from.
 * @returns the stored list and the repair count, or `undefined` when the value
 *   is neither a list nor an empty value. That third answer is deliberate: a
 *   field written with a shape nobody can read is a field nobody said anything
 *   about, and answering it by emptying the list would destroy work over a
 *   typo. The caller refuses it instead, with a sentence the writer can act on.
 */
export declare function readItemStepList(raw: unknown, itemId: string): ItemStepList | undefined;
/**
 * Whether a capture carries nothing anybody wrote.
 *
 * A note with no words in it is not a note, and the empty state promises the
 * reader they can write down a thought — so the gesture that creates the row is
 * the same gesture that writes the first words. The rule lives HERE, named,
 * because it has to be read in two places that must not drift: the composer's
 * save button (which must be disabled for exactly the input the save path would
 * refuse) and the save path itself (which must refuse while KEEPING the words,
 * so a half-typed thought can be finished rather than lost to a disabled
 * button's surprise).
 *
 * Only words count. A tag, a priority or a date is structure the reader typed
 * ON PURPOSE, so a capture that carries nothing but `#画廊` is a filed thought
 * and not an empty one — and a row with a tag and no words is a legitimate
 * "file this under that" note.
 *
 * @param input - the capture as it will be written.
 * @returns whether it would produce a row with nothing in it.
 */
export declare function isBlankCapture(input: Pick<ItemCapture, 'title' | 'body' | 'steps'>): boolean;
/**
 * What a writer brings when it wants a row to exist.
 *
 * Everything the writer DECIDED, and nothing the document derives: no number, no
 * provenance stamp, no birth instant. The three date fields are three
 * independent promises (开始 / 计划 / 截止) and stay three keys here for
 * the same reason they are three columns — collapsing them is how a soft
 * deadline turns into a missed one.
 *
 * THE TEXT IS TYPED, THE REST IS `unknown`, and the asymmetry is the design. A
 * title is words: whatever the writer said is the title, and there is no reading
 * of it to disagree about. Everything else arrives through a MEDIUM — a
 * capture box, a model's JSON payload, a hand-edited file — and each of those
 * fields is read by exactly one named reader below ({@link itemInstantOf}, the
 * tag grammar, {@link readItemStepList}, the two tier checks). Typing them as
 * `unknown` is what makes a cast impossible rather than merely discouraged: a
 * caller cannot hand a string to a date by asserting it is a number, so the one
 * law that says "a value that is not a moment is not a moment" is the only thing
 * standing between a writer and a row with a date the calendar cannot read.
 */
export interface ItemCapture {
    readonly title: string;
    readonly body: string;
    readonly notes: string;
    /** Who is writing. Required, not defaulted: the provenance is the audit
     *  trail's handle and {@link ITEM_FIELDS} forbids anyone from rewriting it, so
     *  a writer that forgot to say would be guessed at on its behalf. */
    readonly origin: ItemOriginSource;
    readonly status?: unknown;
    readonly priority?: unknown;
    readonly steps?: unknown;
    readonly tags?: unknown;
    /** 附件 ref（读者在自己的设备上选的字节）。与别的字段一样是 `unknown`：它从一个
     *  介质来（面板的补丁、模型的 JSON、手改过的文件），所以由**一个具名的读法**
     *  （`normalizeAttachmentRefs`）读，而不是靠调用点断言。 */
    readonly attachments?: unknown;
    readonly startsAfter?: unknown;
    readonly dueAt?: unknown;
    readonly hardDueAt?: unknown;
    readonly taskId?: string;
}
/**
 * Whether a writer's LIST value (steps or tags) is one this layer can read.
 *
 * Three readable answers — "nobody said" (`undefined`), "nobody wants any"
 * (`null` / an empty list) and an actual list — and one unreadable: anything
 * else. The distinction is the whole reason this predicate exists, because the
 * two ends of it need OPPOSITE handling. A readable empty value CLEARS the
 * promise, which is what a reader clearing a date field means; an unreadable
 * one is not a request to clear anything, and answering it by emptying the
 * checklist destroys the reader's own words over a typo. So the caller asks
 * this first and REFUSES the unreadable case with a sentence, instead of
 * letting a shape be silently read as "no steps".
 *
 * @param raw - what the writer supplied.
 * @returns whether this layer can read it at all.
 */
export declare function isItemListValue(raw: unknown): boolean;
/** A minted row, plus the repair count a caller may have to report. */
export interface ItemCaptured {
    readonly item: ItemRecord;
    /** How many steps had to be given an id. Zero for a row with no checklist. */
    readonly mintedSteps: number;
}
/**
 * Mint a row from what a writer decided — the ONE constructor both writers go
 * through.
 *
 * Built twice — once per surface — is how two halves of
 * one document drift into disagreeing about what a freshly written row looks
 * like: the capture box mints its own step ids and stamps `human`, the tool
 * mints different ones and stamps `ai`. So both come through here, and the
 * fields that must always agree — the trimmed text, the step ids, the neutral
 * fallbacks, both ends of the stamp — always do.
 *
 * The unknowns land in the NEUTRAL tier rather than dropping the row, which is
 * the inbound grammar's own repair: the row is the user's work, the enum is
 * ours, and a future version's value must not cost somebody their note. A value
 * that is not a finite instant is not a promise at all, and the three date
 * fields are read through ONE rule so a writer that sends a string where a
 * timestamp belongs cannot land a date the calendar cannot read.
 *
 * A step list this layer cannot read is answered with no steps, which is only
 * safe because a caller with an UNTRUSTED medium is expected to ask
 * {@link isItemListValue} first and refuse; the fallback here is the belt to
 * that caller's braces, not the policy.
 *
 * @param input - what the writer decided.
 * @param now - the writing clock, stamped on both ends of the row.
 * @param mintId - how this writer mints an identity. Required, not defaulted: a
 *   silent fallback would mint the same id twice, and the id is what the merge
 *   grammar keys on — two rows answering to one name is a document that cannot
 *   converge.
 * @returns the row carrying `ref: 0`, which means "not numbered yet": the short
 *   number is the document's to hand out, and a row that showed one before the
 *   document has seen it would be quoting a guess.
 */
export declare function captureItemRecord(input: ItemCapture, now: number, mintId: () => string): ItemCaptured;
