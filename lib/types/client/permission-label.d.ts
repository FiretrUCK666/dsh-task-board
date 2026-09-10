/**
 * Permission-presentation mirror: render one permission preset under the same
 * product-label rule as the native client picker
 * (`@deepseek-ai/dsh-client-ui-permission-presets` presentation), so the task
 * form shows exactly what the GUI's permission selector shows. The option
 * data itself is never hard-coded here — it arrives from the host's native
 * permission service; only this tiny display rule is mirrored.
 */
/**
 * Convert conventional kebab-case preset names into user-facing title case
 * (mirrors the native `displayPresetName`).
 * @param name - host-supplied preset label or key.
 * @returns the title-cased conventional key, or a non-kebab label unchanged.
 */
export declare function displayPresetName(name: string): string;
/**
 * Render a permission preset under its product label (mirrors the native
 * `displayPermissionPreset`).
 * @param value - preset machine value.
 * @param name - host-supplied preset label or key.
 * @returns the Full access product label or the conventional display name.
 */
export declare function permissionLabel(value: string, name?: string): string;
