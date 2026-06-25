import { deviceConfigurationSchema, pinMappingFileSchema } from '@root/backend/shared/types/PLC/devices'
import { PLCProjectSchema } from '@root/backend/shared/types/PLC/open-plc'

export const projectDefaultFilesMapSchema = {
  'project.json': PLCProjectSchema,
  'devices/configuration.json': deviceConfigurationSchema,
  // Accepts both the per-board dict (canonical) and the legacy flat
  // array. See `pinMappingFileSchema` for the migration contract.
  'devices/pin-mapping.json': pinMappingFileSchema,
} as const
export type ProjectDefaultFilesMapKeys = keyof typeof projectDefaultFilesMapSchema
export type ProjectDefaultFilesMapValues = (typeof projectDefaultFilesMapSchema)[ProjectDefaultFilesMapKeys]

export const projectPouDirectories = ['pous/functions', 'pous/function-blocks', 'pous/programs'] as const
export const projectDefaultDirectories = ['devices', ...projectPouDirectories] as const
export const projectDefaultDirectoriesValidation = [...projectDefaultDirectories, 'build'] as readonly string[]
export type ProjectDefaultDirectories = (typeof projectDefaultDirectories)[number]
