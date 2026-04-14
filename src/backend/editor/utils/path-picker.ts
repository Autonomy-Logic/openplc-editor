import { BrowserWindow, dialog } from 'electron'
import { promises } from 'fs'
import { join } from 'path'

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

const getOpenProjectPath = async (serviceManager: GetProjectPathProps) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(serviceManager, {
    title: 'Select a PLC project to open',
    properties: ['openDirectory'],
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

  try {
    await promises.access(join(filePath, 'project.json'))
  } catch {
    return {
      success: false,
      error: {
        title: 'Invalid project',
        description: 'The selected directory is not a valid OpenPLC project. No project.json file found.',
      },
    }
  }

  return {
    success: true,
    path: filePath,
  }
}

export { getOpenProjectPath, getProjectPath }
