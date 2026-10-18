import { type UpdateState } from './update-controller.ts';
/**
 * The controller's current reading, subscribed.
 * @returns the state; re-renders the calling component on every change.
 */
export declare function useUpdateState(): UpdateState;
/**
 * The update button's face for one state.
 *
 * The five states are the controller's own ladder, not a styling choice:
 * `checking` stands the button down, `latest` is a two-second confirmation,
 * `available` names the version it found, `undetermined` says the host could not
 * tell (which is not "up to date"), and `failed` invites another press.
 * @param state - the controller's reading.
 * @returns the localised label.
 */
export declare function updateLabelOf(state: UpdateState): string;
