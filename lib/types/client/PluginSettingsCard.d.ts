/**
 * Shared chrome for the plugin settings card: a disclosure header naming the
 * plugin and what its settings govern, the controls inside, and the save that
 * writes them. Renders always — an unavailable namespace shows a hint in place
 * of the controls rather than disappearing. Mirrors the official ui-plugin-config
 * PluginCard in a self-contained slice (this package must not depend on a
 * sibling UI package).
 */
import { type ReactNode } from 'react';
import type { CardShell } from './settings-form.ts';
import type { SettingsCardKey } from './locales.ts';
/** Card chrome shared by every plugin settings card. */
interface PluginSettingsCardProps {
    /** Locale reader for this card's copy. */
    t: (key: SettingsCardKey) => string;
    /** Locale key of the plugin's name. */
    titleKey: SettingsCardKey;
    /** Locale key of the line describing what this plugin's settings govern. */
    descriptionKey: SettingsCardKey;
    /** The card's form state: availability, writability, and what a save would do. */
    state: CardShell;
    /** Write every staged edit. */
    onSave: () => void;
    /** Drop every staged edit. */
    onDiscard: () => void;
    /** The plugin's controls. */
    children: ReactNode;
}
/**
 * Render one plugin settings card.
 * @param props - the plugin's copy keys, its form state, and its controls.
 * @returns the card; an unavailable namespace renders a hint instead of controls.
 */
export declare function PluginSettingsCard(props: PluginSettingsCardProps): import("react").JSX.Element;
/** Props every field control needs regardless of its value type. */
interface FieldProps {
    /** Stable id associating the label with its control. */
    id: string;
    /** Visible label. */
    label: string;
    /** One-line explanation rendered under the control. */
    hint: string;
    /** Draft text this control renders. */
    text: string;
    /** True when saving would leave a user-layer entry for this field. */
    overridden: boolean;
    /** True when the draft is not a value this field accepts. */
    invalid: boolean;
    /** Copy for the overridden badge. */
    overriddenLabel: string;
    /** Copy for the reset control. */
    resetLabel: string;
    /** Copy shown in place of the hint while the draft is invalid. */
    invalidLabel: string;
    /** Disables every control (read-only document, or an unavailable namespace). */
    disabled: boolean;
    /** Stage draft text. */
    onEdit: (text: string) => void;
    /** Stage a clear so the field re-inherits the composition layer. */
    onReset: () => void;
}
/** A staged boolean field: 继承 / 开 / 关. */
export declare function BooleanField(props: FieldProps & {
    /** Copy for the inherit option. */
    inheritLabel: string;
    /** Copy for the on option. */
    onLabel: string;
    /** Copy for the off option. */
    offLabel: string;
}): import("react").JSX.Element;
export {};
