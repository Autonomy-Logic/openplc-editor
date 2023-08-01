import {
  createProjectController,
  saveProjectController,
} from '@electron/controllers'

import { pou } from '../pou'
import { project } from '../project'
import { toast } from '../toast'

export const click = () => console.log('Will be implemented soon')

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
