import { DebuggerIcon } from '@root/renderer/assets'
import { ActivityBarButton } from '@root/renderer/components/_atoms/buttons'
import { ComponentPropsWithoutRef } from 'react'

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
