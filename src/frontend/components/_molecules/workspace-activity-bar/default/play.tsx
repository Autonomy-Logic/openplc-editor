import { ComponentPropsWithoutRef, ReactNode } from 'react'

import { PlayIcon } from '../../../../assets/icons/interface/Play'
import { useIsNinetiesTheme } from '../../../../hooks/use-nineties-theme'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { RetroPlay } from '../../../_atoms/retro-icons'

type PlayButtonProps = ComponentPropsWithoutRef<typeof ActivityBarButton> & {
  children?: ReactNode
}

export const PlayButton = ({ children, ...props }: PlayButtonProps) => {
  const isNineties = useIsNinetiesTheme()
  return (
    <ActivityBarButton aria-label='Play' {...props}>
      {children || (isNineties ? <RetroPlay /> : <PlayIcon />)}
    </ActivityBarButton>
  )
}
