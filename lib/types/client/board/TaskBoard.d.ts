import { type BoardController } from '../../core/controller.ts';
import type { ItemPriority } from '../../core/item.ts';
import { type BundleFreshnessState } from '../bundle-freshness.ts';
/** Board component; subscribes to the controller snapshot. */
export declare function TaskBoard({ controller, freshness, mountedOf }: {
    controller: BoardController;
    freshness?: BundleFreshnessState;
    mountedOf?: (cardId: string) => {
        readonly count: number;
        readonly loudest?: ItemPriority;
    } | undefined;
}): import("react").JSX.Element;
