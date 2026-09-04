import { ComponentPropsWithoutRef } from 'react'

import ExecuteIcon from '../../../../assets/icons/project/ladder/Execute'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

export const Execute = ({ onDragStart }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Execute'>
      <div draggable onDragStart={onDragStart}>
        <ExecuteIcon />
      </div>
    </ActivityBarButton>
  )
}
