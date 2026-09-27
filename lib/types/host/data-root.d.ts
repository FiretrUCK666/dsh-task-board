/**
 * The harness home directory, resolved the way the host resolves it: an
 * explicit `$DSH_HOME` wins, a blank one counts as unset, and the fallback is
 * `.dsh` under the current user's home.
 * @returns the absolute harness home path.
 */
export declare function harnessHome(): string;
/**
 * The directory the storage hub roots every unit in.
 * @returns the absolute storage root path.
 */
export declare function storagesRoot(): string;
/** Why a legacy file was or was not retired — the UI and the log both read this. */
export type RetireStatus = 
/** The file was ours and has been moved aside. */
'retired'
/** No legacy file exists; nothing to do (the common case after the first boot). */
 | 'absent'
/** A file sits at the legacy path but is not a unit document of ours; left untouched. */
 | 'foreign'
/** The migrated document is not on disk yet, so retiring would strand the data. */
 | 'target-missing'
/** A retired copy from an earlier run already occupies the destination. */
 | 'taken';
/** The outcome of one retirement attempt. */
export interface RetireOutcome {
    /** What happened, in the words the log and the board status line use. */
    readonly status: RetireStatus;
    /** The legacy path that was considered, whether or not it existed. */
    readonly legacyPath: string;
    /** The path the file now lives at; present only when `status` is `retired`. */
    readonly retiredPath?: string;
}
/**
 * The directory a per-record unit occupies under the storage root.
 *
 * This mirrors the backend's own layout rule; it is spelled out here only so
 * the retirement guard can name the exact file a migrated document lands in.
 * A unit that is still a single whole-unit FILE has no directory yet.
 * @param unitName - the unit whose directory to locate.
 * @returns the absolute unit directory path.
 */
export declare function unitDirectoryPath(unitName: string): string;
/** Options for retiring one pre-layout unit file. */
export interface RetireOptions {
    /** The unit whose legacy whole-unit file to retire. */
    readonly unitName: string;
    /** The unit version the legacy file is expected to carry. */
    readonly legacyVersion: number;
    /** Absolute path of the migrated document that proves the data landed. */
    readonly migratedPath: string;
    /** Clock for the destination suffix. */
    readonly now: number;
    /** Diagnostic sink. */
    readonly log: (message: string, error?: unknown) => void;
}
/**
 * Move a pre-layout whole-unit file aside, once.
 *
 * The three guards exist so this can never destroy data: the data must already
 * exist at its new home, the file must really be the unit document we wrote
 * (a stray file of the same name is left alone), and the destination must be
 * free. Every failure returns a status and changes nothing on disk.
 * @param options - which file, which version, where the data landed.
 * @returns what happened, with the paths involved.
 */
export declare function retireLegacyUnitFile(options: RetireOptions): Promise<RetireOutcome>;
