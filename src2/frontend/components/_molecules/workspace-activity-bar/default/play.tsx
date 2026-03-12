import { PlayIcon } from '../../../../assets'
import { ActivityBarButton } from '../../../_atoms/buttons'
import { ComponentPropsWithoutRef, ReactNode } from 'react'

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
