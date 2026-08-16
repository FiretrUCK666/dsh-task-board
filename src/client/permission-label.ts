/**
 * Permission-presentation mirror: render one permission preset under the same
 * product-label rule as the native client picker
 * (`@deepseek-ai/dsh-client-ui-permission-presets` presentation), so the task
 * form shows exactly what the GUI's permission selector shows. The option
 * data itself is never hard-coded here — it arrives from the host's native
 * permission service; only this tiny display rule is mirrored.
 */

/** Machine value of the preset that requires an explicit GUI risk gate. */
const FULL_ACCESS_VALUE = 'danger-full-access'

/**
 * Convert conventional kebab-case preset names into user-facing title case
 * (mirrors the native `displayPresetName`).
 * @param name - host-supplied preset label or key.
 * @returns the title-cased conventional key, or a non-kebab label unchanged.
 */
export function displayPresetName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Render a permission preset under its product label (mirrors the native
 * `displayPermissionPreset`).
 * @param value - preset machine value.
 * @param name - host-supplied preset label or key.
 * @returns the Full access product label or the conventional display name.
 */
export function permissionLabel(value: string, name?: string): string {
  const label = name !== undefined && name !== '' ? name : value
  return value === FULL_ACCESS_VALUE ? 'Full access' : displayPresetName(label)
}
