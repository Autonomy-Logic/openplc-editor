import { ComponentPropsWithoutRef } from 'react'

import { DebuggerIcon } from '../../../../assets/icons/interface/Debugger'
import { useIsNinetiesTheme } from '../../../../hooks/use-nineties-theme'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { RetroDebugger } from '../../../_atoms/retro-icons'

type DebuggerButtonProps = ComponentPropsWithoutRef<typeof ActivityBarButton> & {
  isActive?: boolean
}

export const DebuggerButton = ({ isActive, className, ...props }: DebuggerButtonProps) => {
  const isNineties = useIsNinetiesTheme()
  return (
    <ActivityBarButton
      aria-label='Debugger'
      data-active={isActive ? 'true' : undefined}
      className={className}
      {...props}
    >
      {isNineties ? <RetroDebugger /> : <DebuggerIcon variant={isActive ? 'default' : 'muted'} />}
    </ActivityBarButton>
  )
}
