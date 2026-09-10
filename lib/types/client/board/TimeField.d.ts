export declare function TimeField({ label, hint, placeholder, value, onChange, allowEmpty }: {
    label: string;
    /** Quiet helper text under the field (e.g. "留空=一直保持"). */
    hint?: string;
    /** Input placeholder; falls back to the shared format example. */
    placeholder?: string;
    value: number | undefined;
    onChange: (ms: number | undefined) => void;
    /** Whether clearing the field is legal (undefined value allowed). */
    allowEmpty?: boolean;
}): import("react").JSX.Element;
