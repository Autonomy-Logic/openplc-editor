import { ComponentPropsWithoutRef } from 'react'

import { DebuggerIcon } from '../../../../assets/icons/interface/Debugger'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

type DebuggerButtonProps = ComponentPropsWithoutRef<typeof ActivityBarButton> & {
  isActive?: boolean
}

export const DebuggerButton = ({ isActive, className, ...props }: DebuggerButtonProps) => {
  return (
    <ActivityBarButton
      aria-label='Debugger'
      data-active={isActive ? 'true' : undefined}
      className={className}
      {...props}
    >
      <DebuggerIcon variant={isActive ? 'default' : 'muted'} />
    </ActivityBarButton>
  )
}
