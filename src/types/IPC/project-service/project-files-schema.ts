import { deviceConfigurationSchema, devicePinSchema } from '@root/types/PLC/devices'
import { PLCProjectSchema } from '@root/types/PLC/open-plc'

export const projectDefaultFilesMapSchema = {
  'project.json': PLCProjectSchema,
  'devices/configuration.json': deviceConfigurationSchema,
  'devices/pin-mapping.json': devicePinSchema.array(),
} as const
export type ProjectDefaultFilesMapKeys = keyof typeof projectDefaultFilesMapSchema
export type ProjectDefaultFilesMapValues = (typeof projectDefaultFilesMapSchema)[ProjectDefaultFilesMapKeys]

export const projectDefaultDirectories = ['devices'] as const
export type ProjectDefaultDirectories = (typeof projectDefaultDirectories)[number]
