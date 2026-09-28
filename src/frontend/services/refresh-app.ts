import type { WindowPort } from '../../middleware/shared/ports/window-port'
import type { ModalTypes } from '../store/slices/modal'
import type { WorkspaceState } from '../store/slices/workspace'

/** Reload the app, asking to save first when the reload would drop unsaved work. */
export function requestAppRefresh(
  editingState: WorkspaceState['workspace']['editingState'],
  openModal: (modal: ModalTypes, data?: unknown) => void,
  windowPort: Pick<WindowPort, 'reload'>,
): void {
  if (editingState === 'unsaved') {
    openModal('save-changes-project', { validationContext: 'refresh-app' })
    return
  }
  windowPort.reload()
}
