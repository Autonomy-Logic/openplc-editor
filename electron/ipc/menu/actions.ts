import { createProjectController } from '@electron/controllers'

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
