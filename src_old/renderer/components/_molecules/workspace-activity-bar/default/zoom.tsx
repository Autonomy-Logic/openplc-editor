import { ZoomInOut } from '@root/renderer/assets'
import { ComponentPropsWithoutRef } from 'react'

import { ActivityBarButton } from '../../../_atoms/buttons'

export const ZoomButton = (props: ComponentPropsWithoutRef<'button'>) => {
  return (
    <ActivityBarButton aria-label='Zoom' {...props}>
      <ZoomInOut />
    </ActivityBarButton>
  )
}
