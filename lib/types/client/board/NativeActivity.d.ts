export interface NativeActivityState {
    plan?: {
        active: boolean;
        pending: boolean;
    };
    goal?: {
        title: string;
        active: boolean;
    };
    commands?: Array<{
        name: string;
        description?: string;
    }>;
}
export declare function NativeActivity({ sessionId, onPickCommand, pollMs }: {
    sessionId: string | undefined;
    /** Insert the picked slash command into this surface's composer (no send). */
    onPickCommand: (name: string) => void;
    pollMs?: number;
}): import("react").JSX.Element | null;
