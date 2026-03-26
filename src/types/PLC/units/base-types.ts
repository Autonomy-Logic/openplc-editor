import { baseTypes } from '@root/shared/data'
import { z } from 'zod'

const PLCBaseTypesSchema = z.enum(baseTypes)

type PLCBaseTypes = z.infer<typeof PLCBaseTypesSchema>
type PLCBaseTypesLowercase = Lowercase<PLCBaseTypes>

export { PLCBaseTypes, PLCBaseTypesLowercase, PLCBaseTypesSchema }
