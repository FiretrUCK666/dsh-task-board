/**
 * The React face of the update controller: one subscription, one reading.
 *
 * WHY A HOOK AND NOT `useState` IN EACH PAGE. The controller is a module
 * singleton (see `update-controller.ts`), so the state must be READ from it
 * rather than copied into a page. `useSyncExternalStore` is the built-in that
 * does exactly that: it subscribes during the effect, reads on every render,
 * and cannot tear — the three pages see one answer, in step, by construction.
 *
 * The button's FACE is derived here too, because three pages must print the
 * same words for the same state; a page deriving its own label is a page that
 * will one day say 「检查中」 where its sibling says 「检查更新」.
 */
import { useSyncExternalStore } from 'react'
import { updateController, type UpdateState } from './update-controller.ts'
import { t } from '../locales.ts'
import { isNewerVersion } from '../../core/update-check.ts'

/**
 * The controller's current reading, subscribed.
 * @returns the state; re-renders the calling component on every change.
 */
export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    listener => updateController.subscribe(listener),
    updateController.state,
    // The server snapshot never runs (this bundle is client-only), but
    // `useSyncExternalStore` requires one: the resting state is the honest
    // answer for "nothing has happened yet".
    updateController.state,
  )
}

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
export function updateLabelOf(state: UpdateState): string {
  if (state.phase === 'checking') return t('board.update.checking')
  if (state.phase === 'latest') return t('board.update.latest')
  if (state.phase === 'undetermined') return t('board.update.undetermined')
  if (state.phase === 'failed') return t('board.update.failed')
  if (state.phase === 'available') {
    const latest = state.source?.latest
    const current = state.source?.version
    if (latest !== undefined && current !== undefined && isNewerVersion(latest.version, current)) {
      return t('board.update.available', { v: latest.version })
    }
    // A git install has no comparable version baseline — the remote branch IS
    // its newest — so the button names the outcome instead of a version number
    // it does not have. Saying 「检查更新」 here would be a button that already
    // knows the answer pretending it does not.
    return t('board.update.availableGit')
  }
  return t('board.update.check')
}
