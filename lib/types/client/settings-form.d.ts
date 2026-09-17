/**
 * Staged form model behind the plugin settings card. A card stages what the
 * user types and writes it only when they save — the settings write is a
 * durable, revision-fenced document mutation, so staging keeps what is on
 * screen exactly what a save would store. Mirrors the official
 * ui-plugin-config card-store pattern in a self-contained slice: this
 * package must not depend on a sibling UI package.
 */
import type { SettingsScopeSnapshot, SnapshotStore } from './platform.ts';
/**
 * The minimal settings-scope face the card form needs. A route-backed scope
 * (`RouteSettingsScope`) and the SDK's `SettingsScope<T>` both satisfy it, so
 * the form never depends on a settings-surface package.
 */
export interface SettingsScopeLike<T> {
    /** @returns the current sync snapshot (stable reference until the next change). */
    getSnapshot(): SettingsScopeSnapshot<T>;
    /** Observe snapshot replacements; returns the disposer. */
    subscribe(listener: () => void): () => void;
    /** Queue one field write. */
    set(field: string, value: unknown): Promise<void>;
    /** Queue one field clear, so the field re-inherits the composition layer. */
    unset(field: string): Promise<void>;
}
/** The write one field's staged text performs when the card is saved. */
type FieldWrite = {
    kind: 'set';
    value: unknown;
} | {
    kind: 'clear';
};
/** How one field converts between its stored value and its draft text. */
interface FieldSpec {
    /** Field name inside the namespace section. */
    field: string;
    /** Render a stored value as draft text; the empty string when the section carries none. */
    format: (value: unknown) => string;
    /**
     * The write this draft text stages, or undefined when the text is not a
     * value this field accepts — which blocks the save rather than discarding it.
     */
    parse: (text: string) => FieldWrite | undefined;
}
/** One field as the card renders it. */
export interface FieldState {
    /** Draft text the control renders. */
    text: string;
    /** Whether saving would leave a user-layer entry for this field. */
    overridden: boolean;
    /** Whether the draft is not a value this field accepts, which blocks saving. */
    invalid: boolean;
}
/** Form state every plugin settings card shares. */
export interface CardShell {
    /** False while the namespace is not served to this client; the card renders nothing. */
    available: boolean;
    /** Whether the Host document accepts writes. */
    writable: boolean;
    /** Whether the form holds edits that a save would write. */
    dirty: boolean;
    /** Whether any staged draft is invalid, which blocks the save. */
    invalid: boolean;
    /** Whether a save is crossing the wire. */
    saving: boolean;
    /** Whether the last save did not land as staged; cleared by the next edit or save. */
    failed: boolean;
}
/** The write actions the card's slot entry injects. */
export interface CardActions {
    /** Stage draft text for one field. */
    edit: (field: string, text: string) => void;
    /** Stage a clear, so saving lets the field re-inherit the composition layer. */
    resetField: (field: string) => void;
    /** Write every staged edit, then re-seed from what the Host accepted. */
    save: () => void;
    /** Drop every staged edit. */
    discard: () => void;
}
/** A boolean field, edited through true/false draft text. */
export declare function booleanField(field: string): FieldSpec;
/**
 * Stages one card's edits over one settings namespace and writes them on save.
 *
 * The Host is the only authority on whether a value was accepted — its
 * validators own the constraints no schema can express — so the outcome is
 * read back from the section rather than predicted here. A save that did not
 * land keeps its drafts, so the user can correct them instead of retyping.
 */
export declare class CardForm<T> {
    private readonly scope;
    private readonly specs;
    private readonly staged;
    private readonly listeners;
    private saving;
    private failed;
    /** The scope subscription, released by {@link dispose}. */
    private readonly scopeUnsubscribe;
    /** @param scope - the bound settings scope for this card's namespace. */
    constructor(scope: SettingsScopeLike<T>, specs: FieldSpec[]);
    /** Publish a projection of this form, rebuilt whenever the scope or a draft changes. */
    bind<S>(project: () => S): SnapshotStore<S>;
    /**
     * Drop the scope subscription and every projection listener.
     *
     * The form subscribes to the settings scope in its constructor, so it must be
     * told when the scope's owner is torn down — otherwise the subscription (and
     * the bound store behind it) outlives the namespace it reads. Idempotent.
     */
    dispose(): void;
    /** Read the card-level state: what the Host serves, and what a save would do. */
    shell(): CardShell;
    /** Read one field's state from the effective section and its staged draft. */
    field(field: string): FieldState;
    /** The actions the card's slot registration injects. */
    actions(): CardActions;
    /**
     * Write every staged edit, then re-seed from what the Host accepted.
     * @returns settlement after every write and the read-back.
     */
    save(): Promise<void>;
    /**
     * Every staged edit a save would write. An entry whose draft is not a value
     * its field accepts carries no write: the form is still dirty, and the save
     * refuses rather than dropping the edit. A staged edit that matches the
     * effective section is not a write at all.
     * @returns the planned writes, in the order the fields were staged.
     */
    private plan;
    private clear;
    private store;
    private stage;
    private specOf;
    private snapshotOf;
    private sectionValue;
    private baseValue;
    private userLayer;
    private stored;
    private publish;
}
export {};
