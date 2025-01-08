import { spawn } from 'child_process'
import { dialog, type MessagePortMain } from 'electron'
import { access, constants, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { CreateXMLFile } from '../../../main/utils'
import { ProjectState } from '../../../renderer/store/slices'
import { XmlGenerator } from '../../../utils/PLC/xml-generator'

export type CompilerResponse = {
  error?: boolean
  message: {
    type: 'error' | 'warning' | 'info'
    content: string | Buffer
  }
}

const CompilerService = {
  createBuildDirectoryIfNotExist: async (pathToUserProject: string) => {
    const normalizedUserProjectPath = pathToUserProject.replace('project.json', '')
    const pathToBuildDirectory = join(normalizedUserProjectPath, 'build')
    try {
      await access(pathToBuildDirectory, constants.F_OK)
      return { success: true, message: 'Directory already exists' }
    } catch {
      try {
        await mkdir(pathToBuildDirectory, { recursive: true })
        return { success: true, message: 'Directory created' }
      } catch (err) {
        // @ts-expect-error Unknown type is not being accepted.
        return { success: false, message: `Error creating directory at ${pathToBuildDirectory}: ${err.message}` }
      }
    }
  },
  createXmlFile: async (
    pathToUserProject: string,
    dataToCreateXml: ProjectState['data'],
  ): Promise<{ success: boolean; message: string }> => {
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export Project',
      defaultPath: join(pathToUserProject, 'project.xml'),
      buttonLabel: 'Save',
      filters: [{ name: 'XML Files', extensions: ['xml'] }],
    })

    if (!filePath) {
      return { success: false, message: 'User canceled the save dialog' }
    }

    console.log('dataToCreateXml', dataToCreateXml)

    const { data: projectDataAsString, message } = XmlGenerator(dataToCreateXml)
    if (!projectDataAsString) {
      return { success: false, message: message }
    }

    const result = CreateXMLFile(filePath, projectDataAsString, 'plc')
    try {
      await writeFile(filePath, projectDataAsString)
      console.log('File written successfully to:', filePath)
    } catch (err) {
      console.error('Error writing file:', err)
    }

    return {
      success: result.success,
      message: result.success ? ` XML file created successfully at ${filePath}` : 'Failed to create XML file',
    }
  },

  compileSTProgram: (pathToProjectFile: string, mainProcessPort: MessagePortMain): void => {
    const isDevelopment = process.env.NODE_ENV === 'development'
    const isWindows = process.platform === 'win32'
    const isMac = process.platform === 'darwin'
    const isLinux = process.platform === 'linux'

    const workingDirectory = process.cwd()
    const developmentCompilerPath = join(workingDirectory, 'resources', 'st-compiler', 'xml2st.py')
    const windowsCompilerPath = join(process.resourcesPath, 'assets', 'st-compiler', 'xml2st.exe')
    const darwinCompilerPath = join(process.resourcesPath, 'assets', 'st-compiler', 'xml2st')
    const linuxCompilerPath = join(process.resourcesPath, 'assets', 'st-compiler', 'xml2st.py')

    const draftPath = pathToProjectFile.replace('project.json', '')
    const pathToXMLFile = join(draftPath, 'build', 'plc.xml')

    let execCompilerScript

    if (isDevelopment) {
      if (isWindows) {
        execCompilerScript = spawn('py', [developmentCompilerPath, pathToXMLFile])
      } else if (isMac || isLinux) {
        execCompilerScript = spawn('python3', [developmentCompilerPath, pathToXMLFile])
      }
    } else {
      if (isWindows) {
        execCompilerScript = spawn(windowsCompilerPath, [pathToXMLFile])
      } else if (isMac) {
        execCompilerScript = spawn(darwinCompilerPath, [pathToXMLFile])
      } else if (isLinux) {
        execCompilerScript = spawn('python3', [linuxCompilerPath, pathToXMLFile])
      }
    }

    execCompilerScript?.stdout.on('data', (data: Buffer) => {
      mainProcessPort.postMessage({ type: 'default', data: data })
    })

    execCompilerScript?.stderr.on('data', (data: Buffer) => {
      mainProcessPort.postMessage({ type: 'error', data: data })
      mainProcessPort.close()
    })

    execCompilerScript?.on('close', () => {
      mainProcessPort.postMessage({ type: 'info', message: 'Script finished' })
      mainProcessPort.close()
    })
  },
}

export { CompilerService }
