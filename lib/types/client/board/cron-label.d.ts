/**
 * The human label of a cron expression. An unparseable expression falls back
 * to the raw text (or to `invalid` when the caller wants an explicit silent
 * swap — the preset manager rows show '' instead of the raw expression).
 */
export declare function cronHumanLabel(expr: string, invalid?: string): string;
