import { baseTypes} from '@root/shared/data'
import { z } from 'zod'

const PLCBasetypesSchema = z.enum(baseTypes)

type PLCBasetypes = z.infer<typeof PLCBasetypesSchema>

export { PLCBasetypes, PLCBasetypesSchema }
