import { type ItemSort } from '../../core/item-view.ts';
import { type TaskBoardKey } from '../locales.ts';
/**
 * One facet's values, as buttons. The label is a DICTIONARY KEY and not a word,
 * so the caller hands over the model's own key rather than a string this file
 * would have to recognise — a union written here is a second list of the four
 * faces, and it goes stale the day the model grows one.
 */
interface Face {
    readonly id: string;
    readonly label: TaskBoardKey;
    readonly values: readonly {
        readonly token: string;
        readonly key: string;
        readonly label: string;
    }[];
}
export interface ItemFiltersProps {
    /** The four faces, already reduced to what this document actually holds. */
    readonly faces: readonly Face[];
    /** The whole query, exactly as it stands. The ONLY state. */
    readonly text: string;
    readonly onSearch: (next: string) => void;
    readonly sort: ItemSort;
    readonly onSort: (next: ItemSort) => void;
    readonly tags: readonly (readonly string[])[];
    /** Whether completed rows are shown on the list page. */
    readonly showDone: boolean;
    readonly onShowDone: (next: boolean) => void;
    /** How many rows the filter leaves, for the count beside each open face. */
    readonly countOf: (token: string) => number;
}
/**
 * The bar.
 * @param props - the query, the four faces, the order and the finished switch.
 * @returns the bar, the open face's values, and the echo of what is filtered.
 */
export declare function ItemFilters(props: ItemFiltersProps): import("react").JSX.Element;
export {};
