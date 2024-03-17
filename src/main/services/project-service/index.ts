import { mkdir, promises, readFile, writeFile } from 'fs'
import { join } from 'path'
import { BrowserWindow, dialog } from 'electron'
import { convert, create } from 'xmlbuilder2'

// import { TXmlProject } from '../../shared/contracts/types';

import { ProjectSchema } from '../../../shared/contracts/validations'
import xmlProjectAsObject from '../../../shared/data/mock/object-to-create-project'
import { i18n } from '../../../utils/i18n'
import { ProjectDto } from '../../contracts/types/services/project.service'
import { BaseServiceClass } from '../../contracts/validations'
import { store } from '../../modules/store'
import { configs, data } from './data/config-file'
import { CreateJSONFile } from './utils/json-creator'

// Wip: Refactoring project services.
class ProjectService extends BaseServiceClass<
	InstanceType<typeof BrowserWindow>
> {
	/**
	 * @description Asynchronous function to create a PLC xml project based on selected directory.
	 * @returns A `promise` of `ServiceResponse` type.
	 */
	async createProject() {
		// Show a dialog to select the project directory.
		const res = await dialog.showOpenDialog(this.serviceManager, {
			title: i18n.t('createProject:dialog.title'),
			properties: ['openDirectory'],
		})
		// If the dialog is canceled, return an unsuccessful response
		// otherwise, create a constant containing the selected directory path as a string.
		if (res.canceled) return { ok: false }
		const [filePath] = res.filePaths

		// Checks asynchronously if the selected directory is empty.
		const isEmptyDir = async () => {
			try {
				const directory = await promises.opendir(filePath)
				const entry = await directory.read()
				await directory.close()
				return entry === null
			} catch (error) {
				return false
			}
		}

		// If the selected directory is not empty, return an error response.
		if (!(await isEmptyDir())) {
			return {
				ok: false,
				reason: {
					title: i18n.t('createProject:errors.directoryNotEmpty.title'),
					description: i18n.t(
						'createProject:errors.directoryNotEmpty.description'
					),
				},
			}
		}

		// Check if the data provided is valid, then create a JS Object with the project base structure
		const createdXmlAsObject = ProjectSchema.parse(xmlProjectAsObject)

		// Create the project XML structure using xmlbuilder2.
		const projectAsXml = create(
			{ version: '1.0', encoding: 'utf-8' },
			xmlProjectAsObject
		)

		const configsPath = mkdir(
			join(filePath, 'configs'),
			{ recursive: true },
			(err, path) => {
				if (err) throw err
				return path
			}
		)
		CreateJSONFile({
			path: configsPath as unknown as string,
			fileName: 'project.configs',
			data: JSON.stringify(configs),
		})
		CreateJSONFile({
			path: configsPath as unknown as string,
			fileName: 'project.data',
			data: JSON.stringify(data),
		})

		// Create the path to the project file.
		const projectPath = join(filePath, 'plc.xml')

		// Add the path to the store that will be used for the recent projects data.
		const lastProjects = store.get('last_projects')
		if (lastProjects.length === 10) {
			lastProjects.splice(9, 1)
			lastProjects.unshift(projectPath)
			store.set('last_projects', lastProjects)
		} else {
			store.set('last_projects', [projectPath, ...lastProjects])
		}

		/**
		 * Serialize the XML structure and write it to a file.
		 * If the file creation failed, return an error response,
		 * otherwise return a successful response with the created file path.
		 */

		writeFile(projectPath, projectAsXml.end({ prettyPrint: true }), (error) => {
			if (error) throw error
			return {
				ok: false,
				reason: {
					title: i18n.t('createProject:errors.failedToCreateFile.title'),
					description: i18n.t(
						'createProject:errors.failedToCreateFile.description'
					),
				},
			}
		})
		return {
			ok: true,
			data: { path: projectPath, xmlAsObject: createdXmlAsObject },
		}
	}
	// eslint-disable-next-line consistent-return
	async openProject() {
		const response = await dialog.showOpenDialog(this.serviceManager, {
			title: i18n.t('openProject:dialog.title'),
			properties: ['openFile'],
			filters: [{ name: 'XML', extensions: ['xml'] }],
		})
		// If the dialog is canceled, return an unsuccessful response
		// otherwise, create a constant containing the selected directory path as a string.
		if (response.canceled) return { ok: false }
		const [filePath] = response.filePaths

		// Read the file content asynchronously and store it in a constant.
		const file = await new Promise((resolve, reject) => {
			readFile(filePath, 'utf-8', (error, data) => {
				if (error) return reject(error)
				return resolve(data)
			})
		})

		// If the file content is empty or not available, return an error response.
		if (!file) {
			return {
				ok: false,
				reason: {
					title: i18n.t('openProject:errors.readFile.title'),
					description: i18n.t('openProject:errors.readFile.description', {
						filePath,
					}),
				},
			}
		}
		/**
		 * TODO: Verify the content of the XML file,
		 * TODO: This probably return an file with properties that don't exist in the original schema.
		 * TODO: Needs to be implemented another validation schema.
		 */

		// Convert the XML file content into a serialized object.
		const openXmlProjectAsObj = ProjectSchema.parse(
			convert(file, {
				format: 'object',
			})
		)
		console.log(openXmlProjectAsObj.project.types.pous)

		/**
		 * Return a successful response with the project data,
		 * which is the path to the XML file and the content serialized as a JavaScript object.
		 */
		return {
			ok: true,
			data: {
				path: filePath,
				xmlAsObject: openXmlProjectAsObj,
			},
		}
	}
	/**
	 * @description   Executes the service to save a project as an XML file.
	 * @param filePath - The path where the XML file should be saved.
	 * @param xmlSerializedAsObject - The XML data to be serialized and saved.
	 * @returns A `promise` of `ResponseService` type.
	 */
	async saveProject(data: ProjectDto) {
		const { projectPath, projectAsObj } = data
		// Check if required parameters are provided.
		if (!projectPath || !projectAsObj)
			return {
				ok: false,
				reason: {
					title: i18n.t('saveProject:errors.failedToSaveFile.title'),
					description: i18n.t(
						'saveProject:errors.failedToSaveFile.description'
					),
				},
			}

		// Serialize the XML data using xmlbuilder2.
		const projectAsXml = create(
			// { parser: { cdata: (projectAsObj) => projectAsObj } },
			projectAsObj
		)

		/**
		 * Write the serialized xml to a file.
		 * If the file saving failed, return an error response,
		 * otherwise return a successful response.
		 */
		writeFile(projectPath, projectAsXml.end({ prettyPrint: true }), (error) => {
			if (error) throw error
			return {
				ok: false,
				reason: {
					title: i18n.t('saveProject:errors.failedToSaveFile.title'),
					description: i18n.t(
						'saveProject:errors.failedToSaveFile.description'
					),
				},
			}
		})
		// eslint-disable-next-line no-console
		console.log('Works!')

		return {
			ok: true,
			reason: {
				title: i18n.t('saveProject:success.successToSaveFile.title'),
				description: i18n.t(
					'saveProject:success.successToSaveFile.description'
				),
			},
		}
	}
}

export default ProjectService
