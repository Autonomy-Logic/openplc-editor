import type { ReactNode } from 'react'

import type { ConnectionStatus } from '../../../store/slices/device/types'
import { cn } from '../../../utils/cn'

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
}

/**
 * Connect / Disconnect, for every target type.
 *
 * One component on purpose. A Runtime v4 target and a baremetal target are
 * connected in completely different ways — REST login versus a held Modbus link —
 * but to the user it is the same action in the same place, and it had drifted: the
 * two buttons differed in colour when connected, in when they were disabled, and
 * one of them never showed the green "Connected" confirmation at all. Those are
 * the kind of differences nobody decides on; they accumulate. The connection
 * mechanics stay with each caller, and only the appearance lives here.
 */
const DeviceConnectButton = ({
  status,
  onConnect,
  onDisconnect,
  blockedReason,
  children,
  containerId,
}: DeviceConnectButtonProps) => {
  const isConnected = status === 'connected'
  const isConnecting = status === 'connecting'
  const disabled = isConnecting || blockedReason !== undefined

  return (
    <div id={containerId} className='flex w-full items-center justify-start gap-2'>
      <button
        type='button'
        onClick={isConnected ? onDisconnect : onConnect}
        disabled={disabled}
        title={blockedReason ?? (isConnected ? 'Disconnect from the device' : 'Connect to the device')}
        // Same classes main used for this button. They render correctly again now
        // that cn() knows the cp-* font scale -- before that, twMerge dropped
        // `text-cp-sm` as a conflict with `text-white` and the button jumped to the
        // browser default size.
        className={cn(
          'h-[30px] rounded-md bg-brand px-4 py-1 font-caption text-cp-sm font-medium text-white',
          'hover:bg-brand-medium-dark disabled:opacity-50',
        )}
      >
        {isConnecting ? 'Connecting...' : isConnected ? 'Disconnect' : 'Connect'}
      </button>

      {/* No "Connected" confirmation: the button itself reads "Disconnect" when
          connected, so a second label said the same thing twice. The ERROR state
          below stays, because there the button reads "Connect" and the failure
          would otherwise be invisible. */}
      {status === 'error' && <span className='text-xs text-red-600 dark:text-red-400'>● Connection failed</span>}
      {children}
    </div>
  )
}

export { DeviceConnectButton }
