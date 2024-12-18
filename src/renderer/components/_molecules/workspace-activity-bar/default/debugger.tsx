import { DebuggerIcon } from "@root/renderer/assets"
import { ActivityBarButton } from "@root/renderer/components/_atoms/buttons"
import { ComponentPropsWithoutRef } from "react"

type DebuggerButtonProps = ComponentPropsWithoutRef<typeof ActivityBarButton>
export const DebuggerButton = (props: DebuggerButtonProps) => {
  return (
    <ActivityBarButton aria-label='Debugger' {...props}>
      <DebuggerIcon variant='muted' />
    </ActivityBarButton>
  )
}
