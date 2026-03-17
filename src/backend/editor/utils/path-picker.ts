import { BrowserWindow, dialog } from 'electron'

import { isEmptyDir } from './is-empty-dir'

type GetProjectPathProps = InstanceType<typeof BrowserWindow>

const getProjectPath = async (serviceManager: GetProjectPathProps) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(serviceManager, {
    title: 'Choose an empty directory for new project',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (canceled) {
    return {
      success: false,
      error: {
        title: 'Operation canceled',
        description: 'Operation canceled by the user.',
      },
    }
  }

  const [filePath] = filePaths

  if (!(await isEmptyDir(filePath))) {
    return {
      success: false,
      error: {
        title: 'Directory is not empty',
        description: 'The selected directory is not empty. Please choose an empty directory for a new project.',
      },
    }
  }

  return {
    success: true,
    path: filePath,
  }
}

export { getProjectPath }
