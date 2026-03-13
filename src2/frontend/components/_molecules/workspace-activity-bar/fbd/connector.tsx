import ConnectorIcon from '../../../../assets/icons/project/fbd/Connector'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { ComponentPropsWithoutRef } from 'react'

export const Connector = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Connector'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <ConnectorIcon size='md' />
      </div>
    </ActivityBarButton>
  )
}
