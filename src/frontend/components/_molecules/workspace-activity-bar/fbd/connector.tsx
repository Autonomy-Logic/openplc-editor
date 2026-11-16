import { ComponentPropsWithoutRef } from 'react'

import ConnectorIcon from '../../../../assets/icons/project/fbd/Connector'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { DragSource } from '../../drag-source'

export const Connector = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Connector'>
      <DragSource onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <ConnectorIcon size='md' />
      </DragSource>
    </ActivityBarButton>
  )
}
