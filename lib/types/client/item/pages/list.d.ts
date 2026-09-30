import type { ItemPageProps } from './page-props.ts';
/** The list page's own two additions: nothing but the device's id. */
export interface ItemListPageProps extends ItemPageProps {
    /** This device's id, which every host write on this prefix carries. */
    readonly clientId: string | undefined;
}
export declare function ListPage(props: ItemListPageProps): import("react").JSX.Element;
