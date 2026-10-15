/**
 * Register an overlay's close callback on the Escape stack for as long as it
 * is mounted. Safe with inline closures: the entry is refreshed on every
 * render, so the shared listener always calls the latest callback without
 * re-shuffling the stack order.
 */
export declare function useEscapeStack(onClose: () => void): void;
