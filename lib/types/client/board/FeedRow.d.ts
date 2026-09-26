/**
 * THE one row of both feed drawers (notification center + activity): one
 * skeleton, so question rows, review rows and activity rows can never look
 * like three different widgets again (「排版各搞一块」).
 *
 * Grammar (left to right, top to bottom):
 *   identity line: [任务?] [会话?] [状态]  ……  [时间] [动作…]
 *   content line:  摘录? (one quiet clamped line — the row's substance)
 *   action line:   [动作…]  ……  [时间]
 *
 * The action line puts the BUTTONS FIRST and the time last, with the row
 * carrying the gap between them. The time used to lead the cluster inside its
 * own reserved slot, which parked the buttons a whole slot to the right of
 * where the identity line starts and opened a hole under the task name — so
 * the row's own left edge was not where its controls were. Trailing the time is
 * what puts the actions back on the row's left edge and the stamp on its right,
 * at every width, with no extra markup and no width special case.
 *
 * The optional slots are structural, not stylistic: the notification drawer
 * is FLAT (one row per session) and passes both titles inline; the activity
 * drawer folds under a day → task → session hierarchy and passes the titles
 * to its headers instead, so a grouped row never repeats what its header
 * already says. Everything else — slot ORDER, spacing, clamps, the time
 * stamp, the no-aria-label rule (the row's accessible name IS its content)
 * — is identical by construction.
 */
import type { ReactNode } from 'react';
import { type ChipKind } from './Chip.tsx';
/** Props of one feed row. */
export interface FeedRowProps {
    /** The task title (pre-resolved; untitled rows pass the placeholder). */
    task?: string;
    /** The session title (pre-resolved). */
    session?: string;
    /** Hover title for the session slot — the raw session id, like every
     *  session slot on the board (the visible text is the human title). */
    sessionTitle?: string;
    /** The row's status: kind (colour family) + the already-localized word. */
    status: {
        kind: ChipKind;
        label: string;
    };
    /** The content line: waiting excerpt / activity text — absent = identity
     *  line only (review rows). Clamped to two lines by the shared rule. */
    excerpt?: string;
    /** The row's moment, already formatted (quiet tabular stamp). */
    time: string;
    /** Hover title for the main button (the task title again — it reveals the
     *  full text when the slot ellipsizes). */
    mainTitle?: string;
    /** Main-area click: the notification drawer navigates, the activity drawer
     *  expands its preview — the row skeleton does not care. */
    onMainClick: () => void;
    /** Disclosure state for the activity drawer's preview (undefined = plain
     *  navigation button, no disclosure semantics). */
    mainExpanded?: boolean;
    /** The preview element this button controls (with `mainExpanded`). */
    mainControls?: string;
    /** The action cluster (buttons). It leads its line; the time stamp trails it. */
    actions: ReactNode;
}
/** One feed row (see the module doc for the grammar). */
export declare function FeedRow({ task, session, sessionTitle, status, excerpt, time, mainTitle, onMainClick, mainExpanded, mainControls, actions, }: FeedRowProps): ReactNode;
