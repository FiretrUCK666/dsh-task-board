import { type BoardController } from '../../core/controller.ts';
import type { ItemPriority } from '../../core/item.ts';
import { type BundleFreshnessState } from '../bundle-freshness.ts';
/** Board component; subscribes to the controller snapshot. */
export declare function TaskBoard({ controller, freshness, mountedOf, onOpenRows }: {
    controller: BoardController;
    freshness?: BundleFreshnessState;
    mountedOf?: (cardId: string) => {
        readonly count: number;
        readonly loudest?: ItemPriority;
    } | undefined;
    onOpenRows?: (cardId: string) => void;
}): import("react").JSX.Element;
