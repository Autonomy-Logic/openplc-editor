import { deviceConfigurationSchema, devicePinSchema } from '@root/types/PLC/devices'
import { PLCProjectSchema } from '@root/types/PLC/open-plc'

export const projectFileMapSchema = {
  'project.json': PLCProjectSchema,
  'devices/configuration.json': deviceConfigurationSchema,
  'devices/pin-mapping.json': devicePinSchema.array(),
} as const
export type ProjectFileMapKeys = keyof typeof projectFileMapSchema
export type ProjectFileMapValues = (typeof projectFileMapSchema)[ProjectFileMapKeys]
