import { memo } from 'react'

import { LadderCellElement } from './ladder-cell'
import type { ContactProps } from './utils/types'

export type { ContactNode } from './utils/types'

const Contact = (block: ContactProps) => <LadderCellElement {...block} kind='contact' />

const exportContact = memo(Contact)

export { exportContact as Contact }
