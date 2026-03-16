import { ComponentPropsWithoutRef } from 'react'

import { ZoomInOut } from '../../../../assets/icons/interface/ZoomInOut'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

export const ZoomButton = (props: ComponentPropsWithoutRef<'button'>) => {
  return (
    <ActivityBarButton aria-label='Zoom' {...props}>
      <ZoomInOut />
    </ActivityBarButton>
  )
}
