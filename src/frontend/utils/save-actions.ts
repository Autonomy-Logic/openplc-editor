/**
 * Shared save actions for the OpenPLC editor.
 *
 * These functions are called from multiple UI entry points (keyboard shortcuts,
 * menu items, activity bar, modals) and centralise the save logic so it isn't
 * duplicated. They read state from the store, perform serialization, call the
 * platform port, and update state on success/failure.
 */

import type { ProjectPort } from '../../middleware/shared/ports/project-port'
import { openPLCStoreBase } from '../store'
import { prepareSavePayload } from './save-project'
import { toast } from './toast'

/**
 * Save the entire project (all files, device config, debug variables).
 * Equivalent to Ctrl+Shift+S / "Save Project" menu item.
 */
export async function executeSaveProject(projectPort: ProjectPort): Promise<{ success: boolean }> {
  const state = openPLCStoreBase.getState()
  const { project, editors, editor: activeEditor, deviceDefinitions } = state
  const { setEditingState } = state.workspaceActions
  const { setAllToSaved } = state.fileActions
  const { markAllSaved } = state.snapshotActions

  setEditingState('save-request')
  toast({
    title: 'Save changes',
    description: 'Trying to save the changes in the project file.',
    variant: 'warn',
  })

  try {
    const params = prepareSavePayload({
      projectPath: project.meta.path,
      projectName: project.meta.name,
      projectData: project.data,
      deviceConfiguration: deviceDefinitions.configuration,
      devicePinMapping: deviceDefinitions.pinMapping.pins,
      editors,
      activeEditor,
    })

    const res = await projectPort.saveProject(params)
    if (res.success) {
      setEditingState('saved')
      setAllToSaved()
      markAllSaved()
      toast({
        title: 'Changes saved!',
        description: 'The project was saved successfully!',
        variant: 'default',
      })
    } else {
      setEditingState('unsaved')
      toast({
        title: 'Error in the save request!',
        description: res.error ?? 'Save failed',
        variant: 'fail',
      })
    }
    return { success: res.success }
  } catch {
    setEditingState('unsaved')
    toast({
      title: 'Error in the save request!',
      description: 'An unexpected error occurred while saving.',
      variant: 'fail',
    })
    return { success: false }
  }
}
