import type { ItemPageProps } from './page-props.ts';
/** The list page's own two additions: nothing but the device's id. */
export interface ItemListPageProps extends ItemPageProps {
    /** This device's id, which every host write on this prefix carries. */
    readonly clientId: string | undefined;
    /**
     * Whether the finished rows are on the list, and the one way to change it.
     *
     * IT IS HERE AND NOT ON THE SHARED BUNDLE because the switch belongs to THIS
     * page and to no other: the agenda is a sequence of days and the inbox holds
     * rows nobody has filed, so 「隐藏已完成」 on either of them is a question with
     * no answer. And it has to be READ: a control on the filter bar wired to a
     * `useState` that nothing reads, with the slice cut by a hard-coded
     * `includeDone: true`, says one thing while the list does the other — which is
     * worse than
     * having no control: the reader unticks it, the finished rows stay, and the
     * natural conclusion is that the panel has lost the rows rather than that the
     * switch is a picture of a switch.
     */
    readonly showDone: boolean;
    readonly onShowDone: (next: boolean) => void;
}
export declare function ListPage(props: ItemListPageProps): import("react").JSX.Element;
