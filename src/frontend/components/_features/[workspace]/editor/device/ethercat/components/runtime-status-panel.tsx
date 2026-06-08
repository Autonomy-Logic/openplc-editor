import { cn } from '@root/frontend/utils/cn'
import type {
  EtherCATMasterStatus,
  EtherCATPluginState,
  EtherCATRuntimeStatusResponse,
  EtherCATSlaveStatus,
} from '@root/middleware/shared/ports/ethercat-types'
import { useRuntime } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useRef, useState } from 'react'

const POLL_INTERVAL_MS = 2000

type StatusColor = 'green' | 'yellow' | 'red' | 'gray' | 'blue'

const stateColorMap: Record<EtherCATPluginState, StatusColor> = {
  IDLE: 'gray',
  SCANNING: 'blue',
  CONFIGURING: 'blue',
  TRANSITIONING: 'blue',
  OPERATIONAL: 'green',
  RECOVERING: 'yellow',
  ERROR: 'red',
  STOPPED: 'gray',
}

const colorClasses: Record<StatusColor, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
  gray: 'bg-neutral-400',
  blue: 'bg-blue-500',
}

const colorTextClasses: Record<StatusColor, string> = {
  green: 'text-green-700 dark:text-green-400',
  yellow: 'text-yellow-700 dark:text-yellow-400',
  red: 'text-red-700 dark:text-red-400',
  gray: 'text-neutral-600 dark:text-neutral-400',
  blue: 'text-blue-700 dark:text-blue-400',
}

function StatusDot({ color }: { color: StatusColor }) {
  return <span className={cn('inline-block h-2.5 w-2.5 rounded-full', colorClasses[color])} />
}

function SlaveStateCell({ status }: { status: EtherCATSlaveStatus }) {
  const isOp = status.state === 'OP'
  const hasError = status.has_error
  return (
    <span
      className={cn(
        'text-xs font-medium',
        isOp && !hasError ? 'text-green-700 dark:text-green-400' : '',
        hasError ? 'text-red-700 dark:text-red-400' : '',
        !isOp && !hasError ? 'text-yellow-700 dark:text-yellow-400' : '',
      )}
    >
      {status.state}
    </span>
  )
}

interface RuntimeStatusPanelProps {
  ipAddress: string | null
  jwtToken: string | null
  isConnected: boolean
  /** Master name to filter from the response. If omitted, uses the first master. */
  masterName?: string
}

/**
 * Pick a master from the runtime response — by name when supplied, otherwise
 * the first one. Returns null when the runtime hasn't reported any.
 */
function resolveMasterStatus(
  response: EtherCATRuntimeStatusResponse,
  masterName?: string,
): EtherCATMasterStatus | null {
  if (!response.masters || response.masters.length === 0) return null
  if (masterName) {
    const match = response.masters.find((m) => m.name === masterName)
    if (match) return match
  }
  return response.masters[0]
}

function extractErrorMessage(rawError: string): string {
  // Try to parse JSON error responses from the runtime (e.g. {"status":"error","message":"..."})
  try {
    const parsed = JSON.parse(rawError) as Record<string, unknown>
    if (typeof parsed.message === 'string') return parsed.message
    if (typeof parsed.error === 'string') return parsed.error
  } catch {
    // Not JSON, continue with raw string
  }
  return rawError
}

/**
 * Detect only errors that indicate the EtherCAT plugin endpoint is missing or
 * disabled on the runtime (HTTP 404, HTML error page, or explicit not-loaded
 * messages). Network/connectivity failures like timeouts and "connection
 * refused" are NOT plugin-state issues — they must surface as real errors so
 * users can diagnose their connection instead of seeing a misleading
 * "plugin not active" banner.
 */
function isPluginNotActiveError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('not loaded') ||
    lower.includes('not available') ||
    lower.includes('plugin not active') ||
    lower.includes('plugin not found') ||
    lower.includes('<!doctype') ||
    lower.includes('<html') ||
    lower.includes('404')
  )
}

function RuntimeStatusPanel({ ipAddress, jwtToken, isConnected, masterName }: RuntimeStatusPanelProps) {
  const runtime = useRuntime()
  const [status, setStatus] = useState<EtherCATRuntimeStatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pluginNotActive, setPluginNotActive] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async () => {
    if (!isConnected || !ipAddress || !jwtToken) {
      setStatus(null)
      return
    }

    setIsLoading(true)
    try {
      const result = await runtime.getEthercatRuntimeStatus!()
      if (result.success && result.data) {
        setStatus(result.data)
        setError(null)
        setPluginNotActive(false)
      } else {
        const rawError = result.error ?? 'Failed to get status'
        const cleanMessage = extractErrorMessage(rawError)
        if (isPluginNotActiveError(cleanMessage)) {
          setPluginNotActive(true)
          setError(null)
          setStatus(null)
        } else {
          setPluginNotActive(false)
          setError(cleanMessage)
        }
      }
    } catch (err) {
      setError(String(err))
      setPluginNotActive(false)
    } finally {
      setIsLoading(false)
    }
  }, [isConnected, ipAddress, jwtToken])

  // Start polling when connected
  useEffect(() => {
    if (!isConnected) {
      setStatus(null)
      setError(null)
      setPluginNotActive(false)
      return
    }

    void fetchStatus()

    intervalRef.current = setInterval(() => {
      void fetchStatus()
    }, POLL_INTERVAL_MS)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isConnected, fetchStatus])

  if (!isConnected) {
    return (
      <div className='flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900'>
        <StatusDot color='gray' />
        <span className='text-xs text-neutral-500 dark:text-neutral-400'>Not connected to runtime</span>
      </div>
    )
  }

  if (pluginNotActive) {
    return (
      <div className='flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900'>
        <StatusDot color='gray' />
        <span className='text-xs text-neutral-500 dark:text-neutral-400'>
          EtherCAT plugin not active - start PLC with EtherCAT configuration
        </span>
      </div>
    )
  }

  if (error && !status) {
    return (
      <div className='flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20'>
        <div className='flex items-center gap-2'>
          <StatusDot color='red' />
          <span className='text-xs text-red-700 dark:text-red-300'>{error}</span>
        </div>
        <button
          onClick={() => void fetchStatus()}
          className='text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300'
        >
          Retry
        </button>
      </div>
    )
  }

  const masterStatus = status ? resolveMasterStatus(status, masterName) : null

  if (!status || !masterStatus) {
    return (
      <div className='flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900'>
        <span className='text-xs text-neutral-500 dark:text-neutral-400'>
          {isLoading ? 'Loading status...' : 'Waiting for status...'}
        </span>
      </div>
    )
  }

  const pluginState = masterStatus.plugin_state
  const stateColor = stateColorMap[pluginState] ?? 'gray'

  return (
    <div className='flex flex-col gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900'>
      {/* Plugin state header */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <StatusDot color={stateColor} />
          <span className={cn('text-sm font-semibold', colorTextClasses[stateColor])}>{pluginState}</span>
          <span className='text-xs text-neutral-500 dark:text-neutral-400'>
            ({masterStatus.slave_count} slave{masterStatus.slave_count !== 1 ? 's' : ''}, WKC=
            {masterStatus.expected_wkc})
          </span>
        </div>
        <button
          onClick={() => void fetchStatus()}
          disabled={isLoading}
          className={cn(
            'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
            'border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100',
            'dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700',
            isLoading && 'opacity-50',
          )}
        >
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/*
       * Cycle metrics moved to the Device → Configuration screen
       * (`board.tsx`), which now hosts both the PLC scan-cycle stats and
       * the EtherCAT cycle stats in a unified card grid. This panel keeps
       * the per-slave diagnostics that only make sense in the bus context.
       */}

      {/* Slave table */}
      {masterStatus.slaves.length > 0 && (
        <div className='overflow-x-auto'>
          <table className='w-full text-xs'>
            <thead>
              <tr className='border-b border-neutral-200 text-left text-[10px] uppercase text-neutral-500 dark:border-neutral-700 dark:text-neutral-400'>
                <th className='px-2 py-1'>Pos</th>
                <th className='px-2 py-1'>Name</th>
                <th className='px-2 py-1'>State</th>
                <th className='px-2 py-1'>AL Status</th>
                <th className='px-2 py-1'>Errors</th>
              </tr>
            </thead>
            <tbody>
              {masterStatus.slaves.map((slave) => (
                <tr
                  key={slave.position}
                  className={cn(
                    'border-b border-neutral-100 dark:border-neutral-800',
                    slave.has_error && 'bg-red-50/50 dark:bg-red-900/10',
                  )}
                >
                  <td className='px-2 py-1 font-mono text-neutral-700 dark:text-neutral-300'>{slave.position}</td>
                  <td className='px-2 py-1 text-neutral-800 dark:text-neutral-200'>{slave.name}</td>
                  <td className='px-2 py-1'>
                    <SlaveStateCell status={slave} />
                  </td>
                  <td className='px-2 py-1 font-mono text-neutral-600 dark:text-neutral-400'>
                    {slave.al_status_code === 0
                      ? '-'
                      : `0x${slave.al_status_code.toString(16).toUpperCase().padStart(4, '0')}`}
                  </td>
                  <td className='px-2 py-1 font-mono text-neutral-600 dark:text-neutral-400'>
                    {slave.error_count > 0 ? (
                      <span className='text-red-600 dark:text-red-400'>{slave.error_count}</span>
                    ) : (
                      '0'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export { RuntimeStatusPanel }
