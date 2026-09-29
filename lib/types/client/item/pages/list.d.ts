import { type ItemStatusView } from '../../../core/item-view.ts';
import { type ItemPageProps } from './page-props.ts';
/** The four group counts, plus the list total. Read by the strip, not derived
 *  here: this page must not be the place that decides what the numbers are. */
export interface ItemListPageProps extends ItemPageProps {
    readonly counts: Readonly<Record<ItemStatusView, number>>;
    /** This device's id, which every host write on this prefix carries. */
    readonly clientId: string | undefined;
}
export declare function ListPage(props: ItemListPageProps): import("react").JSX.Element;
