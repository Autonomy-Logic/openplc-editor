import { CONSTANTS } from '@shared/constants'
import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces'

// * Extract properties from the imported CONSTANTS object.

// $ Types
// ---------------------------------------------------------------- //
/**
 * Represents the properties of a project.
 */
interface ProjectProps {
  language?: (typeof CONSTANTS.languages)[keyof typeof CONSTANTS.languages]
  xmlSerializedAsObject?: XMLSerializedAsObject
  filePath?: string
}
/**
 * Represents the data needed to create a new POU.
 */
interface CreatePouData {
  name?: string
  type: (typeof CONSTANTS.types)[keyof typeof CONSTANTS.types]
  language?: (typeof CONSTANTS.languages)[keyof typeof CONSTANTS.languages]
}
/**
 * Represents the data needed to send a project for saving.
 */
interface SendProjectToSaveData {
  project?: XMLSerializedAsObject
  filePath?: string
}
/**
 * Represents the data needed to update the documentation of a POU.
 */
interface UpdateDocumentationData {
  pouName: string
  description: string
}
/**
 * Represents the response when fetching project properties.
 */
interface GetProjectProps {
  ok: boolean
  reason?: { title: string; description?: string }
  data?: ProjectProps
}

export const {
  ProjectProps,
  CreatePouData,
  SendProjectToSaveData,
  UpdateDocumentationData,
  GetProjectProps,
}
