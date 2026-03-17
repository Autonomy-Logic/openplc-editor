import { baseTypes } from '@root/frontend/utils/plc-constants'
import { z } from 'zod'

const PLCBaseTypesSchema = z.enum(baseTypes)

type PLCBaseTypes = z.infer<typeof PLCBaseTypesSchema>
type PLCBaseTypesLowercase = Lowercase<PLCBaseTypes>

export { PLCBaseTypes, PLCBaseTypesLowercase, PLCBaseTypesSchema }
