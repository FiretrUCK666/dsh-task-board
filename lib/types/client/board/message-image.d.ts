import type { BoardController } from '../../core/controller.ts';
import type { TranscriptImage } from './review-transcript.ts';
/** One image of one message. */
export declare function MessageImage({ controller, sessionId, image }: {
    controller: BoardController;
    sessionId: string;
    image: TranscriptImage;
}): import("react").JSX.Element;
/** The image row of one message (nothing when it carries no pictures). */
export declare function MessageImages({ images, sessionId, controller }: {
    images: readonly TranscriptImage[] | undefined;
    sessionId?: string;
    controller?: BoardController;
}): import("react").JSX.Element | null;
