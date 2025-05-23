import { BrowserWindow, dialog } from 'electron'
import { promises } from 'fs'

import { i18n } from '../../../../utils/i18n'

type GetProjectPathProps = InstanceType<typeof BrowserWindow>

const GetProjectPath = async (serviceManager: GetProjectPathProps) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(serviceManager, {
    title: i18n.t('createProject:dialog.title'),
    properties: ['openDirectory', 'createDirectory'],
  })
  if (canceled) {
    return {
      success: false,
      error: {
        title: i18n.t('projectServiceResponses:createProject.errors.canceled.title'),
        description: i18n.t('projectServiceResponses:createProject.errors.canceled.description'),
      },
    }
  }

  const [filePath] = filePaths

  const isEmptyDir = async () => {
    try {
      const directory = await promises.opendir(filePath)
      const entry = await directory.read()
      await directory.close()
      return entry === null
    } catch (_error) {
      return false
    }
  }

  if (!(await isEmptyDir())) {
    return {
      success: false,
      error: {
        title: i18n.t('projectServiceResponses:createProject.errors.directoryNotEmpty.title'),
        description: i18n.t('projectServiceResponses:createProject.errors.directoryNotEmpty.description'),
      },
    }
  }

  return {
    success: true,
    path: filePath,
  }
}

export { GetProjectPath }
