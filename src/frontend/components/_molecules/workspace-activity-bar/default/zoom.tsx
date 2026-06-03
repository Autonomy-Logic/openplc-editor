import { ComponentPropsWithoutRef } from 'react'

import { ZoomInOut } from '../../../../assets/icons/interface/ZoomInOut'
import { useIsNinetiesTheme } from '../../../../hooks/use-nineties-theme'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { RetroZoom } from '../../../_atoms/retro-icons'

export const ZoomButton = (props: ComponentPropsWithoutRef<'button'>) => {
  const isNineties = useIsNinetiesTheme()
  return (
    <ActivityBarButton aria-label='Zoom' {...props}>
      {isNineties ? <RetroZoom /> : <ZoomInOut />}
    </ActivityBarButton>
  )
}
