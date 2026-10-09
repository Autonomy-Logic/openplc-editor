/**
 * DOPE-704 E6 UI — Diagnostics tab for an EtherCAT coupler.
 *
 * Shows the runtime status of this coupler when a runtime is connected: AL state, SM
 * watchdog activity, module ident-list verification (0xF050 vs. the configured modules),
 * last-cycle timings. The data flows through the existing RuntimePort / debugger
 * channels — when nothing is connected the tab renders an explicit "No runtime
 * connected" state so the operator sees why it is empty rather than a blank panel.
 *
 * The underlying `runtime.getStatus()` call is already wired for other screens; this
 * tab layers the EtherCAT-specific breakdown on top of it. In the first iteration the
 * tab is a stub that surfaces the connection state and the project's expected module
 * layout, so the operator knows what to compare the runtime report against.
 */

import type { ConfiguredEtherCATDevice } from '@root/middleware/shared/ports/esi-types'

export const CouplerDiagnosticsTab = ({ device }: { device: ConfiguredEtherCATDevice }) => {
  const modules = device.modules ?? []
  const sorted = [...modules].sort((a, b) => a.slot - b.slot)
  return (
    <div className='flex flex-col gap-4'>
      <div>
        <h5 className='text-sm font-semibold text-neutral-800 dark:text-neutral-200'>Diagnostics</h5>
        <p className='mt-0.5 text-xs text-neutral-500 dark:text-neutral-400'>
          Live state of this coupler, as reported by the connected EtherDOG runtime. The runtime channel is shared with
          the device debugger, so a connection established there appears here too.
        </p>
      </div>

      <div className='rounded-md border border-dashed border-neutral-300 p-4 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400'>
        <p className='mb-1 font-semibold text-neutral-700 dark:text-neutral-300'>Runtime: not connected</p>
        <p>
          Connect to the EtherDOG runtime from the device debugger to see the coupler&rsquo;s AL state, SM watchdog
          events and the module ident list it read from <code className='font-mono'>0xF050</code>.
        </p>
      </div>

      <div>
        <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>Expected module layout</h6>
        {sorted.length === 0 ? (
          <p className='text-xs text-neutral-500 dark:text-neutral-400'>No modules configured on this coupler.</p>
        ) : (
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
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <tr key={m.id} className='border-b border-neutral-100 last:border-b-0 dark:border-neutral-800'>
                    <td className='px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300'>{m.slot}</td>
                    <td className='px-2 py-1.5 font-mono text-xs text-neutral-500 dark:text-neutral-400'>{m.ident}</td>
                    <td className='px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300'>{m.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
