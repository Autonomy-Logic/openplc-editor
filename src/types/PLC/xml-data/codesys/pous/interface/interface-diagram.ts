import { baseTypes } from '@root/shared/data'
import { z } from 'zod'

import { variableXMLSchema } from '../../variable/variable-diagram'

const interfaceXMLSchema = z.object({
  returnType: z.object(Object.fromEntries(baseTypes.map(type => [type, z.string().optional()]))).optional(),
  inputVars: z
    .object({
      variable: z.array(variableXMLSchema).optional(),
    })
    .optional(),
  outputVars: z
    .object({
      variable: z.array(variableXMLSchema).optional(),
    })
    .optional(),
  inOutVars: z
    .object({
      variable: z.array(variableXMLSchema).optional(),
    })
    .optional(),
  externalVars: z
    .object({
      variable: z.array(variableXMLSchema).optional(),
    })
    .optional(),
  localVars: z
    .object({
      variable: z.array(variableXMLSchema).optional(),
    })
    .optional(),
  tempVars: z
    .object({
      variable: z.array(variableXMLSchema).optional(),
    })
    .optional(),
})
type InterfaceXML = z.infer<typeof interfaceXMLSchema>

export { interfaceXMLSchema }
export type { InterfaceXML }
