import type { ConfiguredEtherCATDevice } from '@root/middleware/shared/ports/esi-types'

export const CouplerDiagnosticsTab = ({ device }: { device: ConfiguredEtherCATDevice }) => {
  const sorted = [...(device.modules ?? [])].sort((a, b) => a.slot - b.slot)
  return (
    <div className='flex flex-col gap-4'>
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
              sorted.map((m) => (
                <tr key={m.id} className='border-b border-neutral-100 last:border-b-0 dark:border-neutral-800'>
                  <td className='px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300'>{m.slot}</td>
                  <td className='px-2 py-1.5 font-mono text-xs text-neutral-500 dark:text-neutral-400'>{m.ident}</td>
                  <td className='px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300'>{m.name}</td>
                  <td className='px-2 py-1.5 text-xs text-neutral-500 dark:text-neutral-400'>Not connected</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
