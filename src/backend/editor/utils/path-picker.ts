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

const getPlcopenImportFilePath = async (serviceManager: GetProjectPathProps) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(serviceManager, {
    title: 'Select a PLCopen XML file to import',
    properties: ['openFile'],
    filters: [{ name: 'PLCopen XML', extensions: ['xml'] }],
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
    const content = await promises.readFile(filePath, 'utf-8')
    return { success: true, content }
  } catch {
    return {
      success: false,
      error: {
        title: 'Error reading file',
        description: 'Failed to read the selected PLCopen XML file.',
      },
    }
  }
}

const getPlcopenExportSavePath = async (
  serviceManager: GetProjectPathProps,
  defaultFileName: string,
  xml: string,
) => {
  const { canceled, filePath } = await dialog.showSaveDialog(serviceManager, {
    title: 'Export PLCopen XML',
    defaultPath: defaultFileName,
    filters: [{ name: 'PLCopen XML', extensions: ['xml'] }],
  })
  if (canceled || !filePath) {
    return {
      success: false,
      error: {
        title: 'Operation canceled',
        description: 'Operation canceled by the user.',
      },
    }
  }

  try {
    await promises.writeFile(filePath, xml, 'utf-8')
    return { success: true }
  } catch {
    return {
      success: false,
      error: {
        title: 'Error writing file',
        description: 'Failed to write the PLCopen XML file.',
      },
    }
  }
}

export { getOpenProjectPath, getPlcopenExportSavePath, getPlcopenImportFilePath, getProjectPath }
