import type { IoMappingEntry } from '@root/middleware/shared/ports/types'
import { type ReactNode, useEffect, useState } from 'react'

/**
 * Commits on blur so the rename cascade runs once per edit, not once per keystroke.
 * `onCommit` returning false means the alias was refused, and the input shows the stored value again.
 */
function AliasInputCell({
  value,
  label,
  onCommit,
}: {
  value: string
  label?: string
  onCommit: (next: string) => boolean | void
}) {
  const [local, setLocal] = useState(value)
  useEffect(() => {
    setLocal(value)
  }, [value])
  return (
    <input
      type='text'
      aria-label={label}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value && onCommit(local) === false) setLocal(value)
      }}
      placeholder='Alias...'
      className='h-[26px] w-full rounded border border-neutral-100 bg-white px-2 font-caption text-cp-sm text-neutral-850 outline-none placeholder:text-neutral-400 focus:border-brand-medium-dark dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300 dark:placeholder:text-neutral-600'
    />
  )
}

const HEADER_CELL = 'px-2 py-1.5 font-caption text-[11px] font-medium text-neutral-500 dark:text-neutral-400'

type IoChannelTableProps = {
  entries: IoMappingEntry[]
  typeOf: (entry: IoMappingEntry) => string
  /** Adds the Mode column when given. */
  renderMode?: (entry: IoMappingEntry) => ReactNode
  aliasLabel?: (entry: IoMappingEntry) => string
  onAliasCommit: (entry: IoMappingEntry, next: string) => boolean | void
}

function IoChannelTable({ entries, typeOf, renderMode, aliasLabel, onAliasCommit }: IoChannelTableProps) {
  return (
    <section>
      <h4 className='mb-2 font-caption text-sm font-semibold text-neutral-950 dark:text-white'>I/O Mapping</h4>
      <table className='w-full text-left'>
        <thead>
          <tr className='border-b border-neutral-200 dark:border-neutral-700'>
            <th className={HEADER_CELL}>Channel</th>
            <th className={HEADER_CELL}>Type</th>
            {renderMode && <th className={HEADER_CELL}>Mode</th>}
            <th className={HEADER_CELL}>IEC Address</th>
            <th className={HEADER_CELL}>Alias</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={`${entry.slot}-${entry.channelName}`}
              className='border-b border-neutral-100 last:border-b-0 dark:border-neutral-800'
            >
              <td className='px-2 py-1.5 font-caption text-cp-sm text-neutral-850 dark:text-neutral-300'>
                {entry.channelName}
              </td>
              <td className='px-2 py-1.5 font-caption text-cp-sm text-neutral-500 dark:text-neutral-400'>
                {typeOf(entry)}
              </td>
              {renderMode && <td className='px-2 py-1.5'>{renderMode(entry)}</td>}
              <td className='px-2 py-1.5 font-mono text-cp-sm font-medium text-brand dark:text-brand-light'>
                {entry.iecAddress}
              </td>
              <td className='px-1 py-1'>
                <AliasInputCell
                  value={entry.alias ?? ''}
                  label={aliasLabel?.(entry)}
                  onCommit={(next) => onAliasCommit(entry, next)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

export { AliasInputCell, IoChannelTable }
