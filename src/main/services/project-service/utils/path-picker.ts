import { BrowserWindow, dialog } from 'electron'

import { i18n } from '../../../../utils/i18n'
import { isEmptyDir } from './is-empty-dir'

type GetProjectPathProps = InstanceType<typeof BrowserWindow>

const getProjectPath = async (serviceManager: GetProjectPathProps) => {
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

  if (!(await isEmptyDir(filePath))) {
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

export { getProjectPath }
