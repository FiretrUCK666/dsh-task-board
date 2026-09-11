import { type BoardController } from '../../core/controller.ts';
import { type BundleFreshnessState } from '../bundle-freshness.ts';
/** Board component; subscribes to the controller snapshot. */
export declare function TaskBoard({ controller, freshness }: {
    controller: BoardController;
    freshness?: BundleFreshnessState;
}): import("react").JSX.Element;
