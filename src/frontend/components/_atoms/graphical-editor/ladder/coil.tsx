import { memo } from 'react'

import { LadderCellElement } from './ladder-cell'
import type { CoilProps } from './utils/types'

export type { CoilNode } from './utils/types'

const Coil = (block: CoilProps) => <LadderCellElement {...block} kind='coil' />

const exportCoil = memo(Coil)

export { exportCoil as Coil }
