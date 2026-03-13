import { ZoomInOut } from '../../../../assets/icons/interface/ZoomInOut'
import { ComponentPropsWithoutRef } from 'react'

import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

export const ZoomButton = (props: ComponentPropsWithoutRef<'button'>) => {
  return (
    <ActivityBarButton aria-label='Zoom' {...props}>
      <ZoomInOut />
    </ActivityBarButton>
  )
}
