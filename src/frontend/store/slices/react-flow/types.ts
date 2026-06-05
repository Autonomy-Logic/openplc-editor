import { z } from 'zod'

import { edgeSchema, nodeSchema } from '../../../../middleware/shared/ports/flow-schemas'

type NodeType = z.infer<typeof nodeSchema>
type EdgeType = z.infer<typeof edgeSchema>

export { edgeSchema, nodeSchema }

export type { EdgeType, NodeType }
