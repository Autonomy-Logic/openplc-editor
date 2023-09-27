import {
  createProjectController,
  saveProjectController,
} from '@electron/controllers'

import { pou } from '../pou'
import { project } from '../project'
import { toast } from '../toast'

/**
 * Placeholder for click event handling. To be implemented.
 */
export const click = () => console.log('Will be implemented soon')

/**
 * Handles the action when "Create Project" menu item is clicked.
 * Initiates the project creation process and updates the UI accordingly.
 */
export const handleCreateProject = async () => {
  const { ok, reason, data } = await createProjectController.handle()
  if (!ok && reason) {
    toast.send({
      type: 'error',
      ...reason,
    })
  } else if (ok && data) {
    pou.createWindow()
    await project.send(data)
  }
}

/**
 * Handles the action when "Save Project" menu item is clicked.
 * Initiates the project saving process and updates the UI accordingly.
 */
export const handleSaveProject = () => {
  const responseListener = project.getProjectToSave()
  responseListener(async (data) => {
    if (!data) return
    const { filePath, xmlSerializedAsObject } = data
    const { ok, reason } = await saveProjectController.handle(
      filePath,
      xmlSerializedAsObject,
    )
    if (!ok && reason) {
      toast.send({
        type: 'error',
        ...reason,
      })
    } else if (ok && reason) {
      toast.send({
        type: 'success',
        ...reason,
      })
    }
  })
}
