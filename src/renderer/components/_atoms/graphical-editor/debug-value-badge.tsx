import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'

type DebugValueBadgeProps = {
  compositeKey: string
  variableType: string | undefined
  position?: 'right' | 'left' | 'below'
}

/**
 * Displays a real-time debug value badge next to graphical editor nodes.
 * Shows the current polled value for non-BOOL variables when the debugger is active.
 * BOOL variables are skipped since they already have dedicated color indicators.
 *
 * Designed to be used by both FBD and LD variable/block nodes.
 */
const DebugValueBadge = ({ compositeKey, variableType, position = 'right' }: DebugValueBadgeProps) => {
  const {
    workspace: { debugVariableValues },
  } = useOpenPLCStore()

  if (!variableType || variableType.toUpperCase() === 'BOOL') {
    return null
  }

  const value = debugVariableValues.get(compositeKey)
  if (value === undefined) {
    return null
  }

  const positionClasses: Record<string, string> = {
    right: 'left-full ml-1 top-1/2 -translate-y-1/2',
    left: 'right-full mr-1 top-1/2 -translate-y-1/2',
    below: 'top-full mt-0.5 left-1/2 -translate-x-1/2',
  }

  return (
    <div
      className={cn(
        'pointer-events-none absolute z-20 flex items-center whitespace-nowrap rounded px-1.5 py-0.5',
        'bg-[#2E7D32] text-[10px] font-semibold leading-tight text-white',
        'dark:bg-[#388E3C]',
        positionClasses[position],
      )}
    >
      {value}
    </div>
  )
}

export { DebugValueBadge }
export type { DebugValueBadgeProps }
