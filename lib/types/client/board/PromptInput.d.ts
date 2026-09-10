import type { BoardController } from '../../core/controller.ts';
/** Prompt textarea with a slash-command and official-reference dropdown. */
export declare function PromptInput({ value, onChange, placeholder, rows, controller, sessionId, invalid }: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    rows?: number;
    controller: BoardController;
    /** The target session scoping the '@' reference menu (file cwd + session
     *  discovery). undefined = '@' stays closed (no menu); '/' is unaffected. */
    sessionId?: string;
    /** Validation error state: the field's invalid border. */
    invalid?: boolean;
}): import("react").JSX.Element;
