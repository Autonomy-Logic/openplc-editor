import { BrowserWindow, dialog } from 'electron'
import { promises, readFile, writeFile } from 'fs'
import { join } from 'path'

import { IProject, projectSchema } from '../../../types/PLC'
import { i18n } from '../../../utils/i18n'
import { store } from '../../modules/store' // This must be refactored
import { baseJsonStructure } from './data'
import { CreateJSONFile } from './utils/json-creator'

export type IProjectServiceResponse = {
  success: boolean
  error?: {
    title: string
    description: string
  }
  message?: string
  data?: {
    meta: {
      path: string
    }
    content: IProject
  }
}

class ProjectService {
  constructor(private serviceManager: InstanceType<typeof BrowserWindow>) {}

  async createProject(): Promise<IProjectServiceResponse> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.serviceManager, {
      title: i18n.t('createProject:dialog.title'),
      properties: ['openDirectory', 'createDirectory'],
    })

    if (canceled)
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:createProject.errors.canceled.title'),
          description: i18n.t('projectServiceResponses:createProject.errors.canceled.description'),
        },
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

    CreateJSONFile({
      path: filePath,
      fileName: 'data',
      data: JSON.stringify(baseJsonStructure, null, 2),
    })

    const projectPath = join(filePath, 'data.json')

    // !Deprecated: Should be removed
    const lastProjects = store.get('last_projects')
    if (lastProjects.length === 10) {
      lastProjects.splice(9, 1)
      lastProjects.unshift(projectPath)
      store.set('last_projects', lastProjects)
    } else {
      store.set('last_projects', [projectPath, ...lastProjects])
    }

    return {
      success: true,
      data: {
        meta: {
          path: projectPath,
        },
        content: baseJsonStructure,
      },
    }
  }

  async openProject(): Promise<IProjectServiceResponse> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.serviceManager, {
      title: i18n.t('openProject:dialog.title'),
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })

    if (canceled)
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:openProject.errors.canceled.title'),
          description: i18n.t('projectServiceResponses:openProject.errors.canceled.description'),
        },
      }
    const [filePath] = filePaths

    const file = await new Promise((resolve, reject) => {
      readFile(filePath, 'utf-8', (error, data) => {
        if (error) return reject(error)
        return resolve(data)
      })
    })

    if (!file) {
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:openProject.errors.readFile.title'),
          description: i18n.t('projectServiceResponses:openProject.errors.readFile.description', {
            filePath,
          }),
        },
      }
    }

    const parsedFile = projectSchema.safeParse(JSON.parse(file as string))

    if (!parsedFile.success) {
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:openProject.errors.readFile.title'),
          description: i18n.t('projectServiceResponses:openProject.errors.readFile.description'),
        },
      }
    }
    return {
      success: true,
      data: {
        meta: {
          path: filePath,
        },
        content: parsedFile.data,
      },
    }
  }

  saveProject(data: { projectPath: string; projectData: IProject }): IProjectServiceResponse {
    const { projectPath, projectData } = data
    if (!projectPath || !projectData)
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:saveProject.errors.missingParams.title'),
          description: i18n.t('projectServiceResponses:saveProject.errors.missingParams.description'),
        },
      }

    const normalizedDataToWrite = JSON.stringify(projectData, null, 2)

    writeFile(projectPath, normalizedDataToWrite, (error) => {
      if (error) throw error
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:saveProject.errors.failedToSaveFile.title'),
          description: i18n.t('projectServiceResponses:saveProject.errors.failedToSaveFile.description'),
        },
      }
    })

    return {
      success: true,
      message: i18n.t('projectServiceResponses:saveProject.success.successToSaveFile.message'),
    }
  }
}

export default ProjectService
