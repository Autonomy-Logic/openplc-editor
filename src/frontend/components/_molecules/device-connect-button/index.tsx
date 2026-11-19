import type { ReactNode } from 'react'

import type { ConnectionStatus } from '../../../store/slices/device/types'
import { cn } from '../../../utils/cn'

type DeviceConnectActivity = {
  label: string
  onClick: () => void
}

type DeviceConnectButtonProps = {
  /** Live connection state. Both target families use the same four states. */
  status: ConnectionStatus
  /** Establish the connection. Called only when not already connected. */
  onConnect: () => void
  /** Tear the connection down. Called only when connected. */
  onDisconnect: () => void
  /**
   * When set, the button is disabled and this says why (also the tooltip) — e.g.
   * no communication port has been picked yet.
   */
  blockedReason?: string
  /** Detail shown beside the status: PLC state, license badge. */
  children?: ReactNode
  /** DOM id kept for the existing onboarding/tour anchors. */
  containerId?: string
  activity?: DeviceConnectActivity
}

/** Connect / Disconnect button for every target type. The connection mechanics stay with each caller. */
const DeviceConnectButton = ({
  status,
  onConnect,
  onDisconnect,
  blockedReason,
  children,
  containerId,
  activity,
}: DeviceConnectButtonProps) => {
  const isConnected = status === 'connected'
  const isConnecting = status === 'connecting'
  const disabled = activity === undefined && (isConnecting || blockedReason !== undefined)
  const connectionLabel = isConnecting ? 'Connecting...' : isConnected ? 'Disconnect' : 'Connect'
  const connectionTitle = blockedReason ?? (isConnected ? 'Disconnect from the device' : 'Connect to the device')

  return (
    <div id={containerId} className='flex w-full items-center justify-start gap-2'>
      <button
        type='button'
        onClick={activity?.onClick ?? (isConnected ? onDisconnect : onConnect)}
        disabled={disabled}
        title={activity?.label ?? connectionTitle}
        data-testid={activity === undefined ? undefined : 'device-connect-activity'}
        className={cn(
          'h-[30px] rounded-md bg-brand px-4 py-1 font-caption text-cp-sm font-medium text-white',
          'hover:bg-brand-medium-dark disabled:opacity-50',
        )}
      >
        {activity?.label ?? connectionLabel}
      </button>

      {status === 'error' && <span className='text-xs text-red-600 dark:text-red-400'>● Connection failed</span>}
      {children}
    </div>
  )
}

export { DeviceConnectButton }
