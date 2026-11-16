import type { ConfiguredEtherCATDevice } from '@root/middleware/shared/ports/esi-types'
import type { DiagnosticsSnapshot } from '@root/middleware/shared/ports/ethercat-diagnostics-port'
import { useEtherCATDiagnostics } from '@root/middleware/shared/providers/platform-context'
import { decodeCouplerStatus, decodeModuleStatus } from '@root/middleware/shared/utils/ethercat/diagnostics-decode'
import { useCallback, useEffect, useState } from 'react'

type CouplerDiagnosticsTabProps = {
  device: ConfiguredEtherCATDevice
  busName: string
}

export const CouplerDiagnosticsTab = ({ device, busName }: CouplerDiagnosticsTabProps) => {
  const diagnosticsPort = useEtherCATDiagnostics()
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const sorted = [...(device.modules ?? [])].sort((a, b) => a.slot - b.slot)

  const poll = useCallback(async () => {
    if (diagnosticsPort === undefined) {
      setError('Diagnostics are not available on this platform.')
      return
    }
    setIsPolling(true)
    setError(null)
    try {
      const result = await diagnosticsPort.pollDiagnostics({
        busName,
        slavePosition: device.position ?? 1,
      })
      if (!result.success) {
        setError(result.error ?? 'Diagnostics poll failed.')
        return
      }
      setSnapshot(result.snapshot)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsPolling(false)
    }
  }, [busName, device.position, diagnosticsPort])

  // Poll once on mount; the user drives subsequent refreshes with the button so
  // the diagnostics screen never hammers the runtime.
  useEffect(() => {
    void poll()
  }, [poll])

  const statusWord = snapshot?.coupler.statusWord ?? null
  const coupler = statusWord !== null ? decodeCouplerStatus(statusWord) : null
  const moduleStatusBySlot = new Map<number, number | null>(
    (snapshot?.modules ?? []).map((m) => [m.slot, m.statusByte]),
  )

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <button
          type='button'
          onClick={() => void poll()}
          disabled={isPolling || diagnosticsPort === undefined}
          className='rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800'
        >
          {isPolling ? 'Polling…' : 'Refresh'}
        </button>
        {snapshot !== null && !isPolling && (
          <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>
            Last poll: {new Date(snapshot.coupler.pollAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {error !== null && (
        <div className='rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300'>
          {error}
        </div>
      )}

      {snapshot !== null && statusWord === null && (
        <div className='rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'>
          The coupler status could not be read.
        </div>
      )}

      {coupler?.ioConfigurationError === true && (
        <div className='rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'>
          I/O configuration error: the modules on the station do not match the project configuration.
        </div>
      )}

      {coupler?.masterConfigurationError === true && (
        <div className='rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'>
          Master configuration error: the coupler refused the configuration written at startup. Check the module list
          and rebuild.
        </div>
      )}

      <div className='overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800'>
        <table className='w-full'>
          <thead className='bg-neutral-50 dark:bg-neutral-900'>
            <tr>
              <th className='px-2 py-1.5 text-left text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
                Slot
              </th>
              <th className='px-2 py-1.5 text-left text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
                Ident
              </th>
              <th className='px-2 py-1.5 text-left text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
                Name
              </th>
              <th className='px-2 py-1.5 text-left text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
                State
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={4} className='px-2 py-4 text-center text-xs text-neutral-500 dark:text-neutral-400'>
                  No modules configured on this coupler.
                </td>
              </tr>
            ) : (
              sorted.map((m) => {
                const raw = moduleStatusBySlot.get(m.slot)
                const decoded = raw !== undefined && raw !== null ? decodeModuleStatus(raw) : null
                const stateLabel =
                  decoded !== null
                    ? decoded.message
                    : snapshot === null
                      ? 'Polling…'
                      : raw === null
                        ? 'Status could not be read'
                        : 'No status reported'
                const stateClass =
                  decoded?.operational === true
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : decoded !== null
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-neutral-500 dark:text-neutral-400'
                return (
                  <tr key={m.id} className='border-b border-neutral-100 last:border-b-0 dark:border-neutral-800'>
                    <td className='px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300'>{m.slot}</td>
                    <td className='px-2 py-1.5 font-mono text-xs text-neutral-500 dark:text-neutral-400'>{m.ident}</td>
                    <td className='px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300'>{m.name}</td>
                    <td className={`px-2 py-1.5 text-xs ${stateClass}`}>{stateLabel}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
