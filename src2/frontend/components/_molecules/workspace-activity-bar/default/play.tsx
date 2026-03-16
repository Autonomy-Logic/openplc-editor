import { ComponentPropsWithoutRef, ReactNode } from 'react'

import { PlayIcon } from '../../../../assets/icons/interface/Play'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

type PlayButtonProps = ComponentPropsWithoutRef<typeof ActivityBarButton> & {
  children?: ReactNode
}

export const PlayButton = ({ children, ...props }: PlayButtonProps) => {
  return (
    <ActivityBarButton aria-label='Play' {...props}>
      {children || <PlayIcon />}
    </ActivityBarButton>
  )
}
