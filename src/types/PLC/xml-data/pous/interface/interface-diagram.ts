import { z } from 'zod'

import { variableXMLSchema } from '../../variable/variable-diagram'

const interfaceXMLSchema = z.object({
  returnType: z.string().optional(),
  inputVars: z.array(variableXMLSchema).optional(),
  outputVars: z.array(variableXMLSchema).optional(),
  inOutVars: z.array(variableXMLSchema).optional(),
  externalVars: z.array(variableXMLSchema).optional(),
  localVars: z.array(variableXMLSchema).optional(),
  tempVars: z.array(variableXMLSchema).optional(),
})
type InterfaceXML = z.infer<typeof interfaceXMLSchema>

export { interfaceXMLSchema }
export type { InterfaceXML }
