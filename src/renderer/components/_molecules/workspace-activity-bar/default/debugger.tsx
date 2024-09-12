import { DebuggerIcon } from "@root/renderer/assets"
import { ActivityBarButton } from "@root/renderer/components/_atoms/buttons"

export const DebuggerButton = () => {
  return (
    <ActivityBarButton aria-label='Debugger'>
      <DebuggerIcon variant='muted' />
    </ActivityBarButton>
  )
}
