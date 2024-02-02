import z from 'zod'

import { PouSchema } from '../validations'

export type TPou = z.infer<typeof PouSchema>
