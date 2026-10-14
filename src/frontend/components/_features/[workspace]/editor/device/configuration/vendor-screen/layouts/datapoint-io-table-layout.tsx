import { toast } from '@root/frontend/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore, useOpenPLCStoreApi } from '@root/frontend/store'
import { DEVICE_SETUP_KEY, IO_MAPPING_KEY } from '@root/frontend/utils/vpp/persistence-keys'
import type { IoMappingEntry } from '@root/middleware/shared/ports/types'
import {
  buildAddressPool,
  buildAliasRegistry,
  describeAliasRejection,
  validateAliasEdit,
} from '@root/middleware/shared/utils/iec-address'
import { vppDatapointMemoryKey, vppMemoryKey } from '@root/middleware/shared/utils/iec-address/registry'
import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'
import { useEffect, useMemo, useState } from 'react'

type StoredModule = { guid: string; instanceName: string; typeId: string; slot: number }

function readModules(value: unknown): StoredModule[] {
  if (!value || typeof value !== 'object' || !('modules' in value) || !Array.isArray(value.modules)) return []
  return value.modules
    .filter(
      (module: unknown): module is StoredModule =>
        !!module &&
        typeof module === 'object' &&
        'guid' in module &&
        typeof module.guid === 'string' &&
        'slot' in module &&
        typeof module.slot === 'number',
    )
    .sort((a, b) => a.slot - b.slot)
}

function readEntries(value: unknown): IoMappingEntry[] {
  if (!value || typeof value !== 'object' || !('entries' in value) || !Array.isArray(value.entries)) return []
  return value.entries.filter((entry: unknown): entry is IoMappingEntry => !!entry && typeof entry === 'object')
}

/** Commits on blur so the rename cascade runs once per edit, not once per keystroke. */
function AliasInputCell({
  value,
  label,
  onCommit,
}: {
  value: string
  label: string
  onCommit: (next: string) => void
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
        if (local !== value) onCommit(local)
      }}
      placeholder='Alias...'
      className='h-[26px] w-full rounded border border-neutral-100 bg-white px-2 font-caption text-cp-sm text-neutral-850 outline-none placeholder:text-neutral-400 focus:border-brand-medium-dark dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300 dark:placeholder:text-neutral-600'
    />
  )
}

const HEADER_CELL = 'px-3 py-1.5 font-caption text-[11px] font-medium text-neutral-500 dark:text-neutral-400'

/**
 * Read-only view of the station an embedded configurator reports: modules from
 * `device-setup`, channels from `io-mapping`. The station is edited only in the
 * configurator, so the Alias is the one thing this table writes.
 */
function DatapointIoTableLayout() {
  const store = useOpenPLCStoreApi()
  const setVendorScreenData = useOpenPLCStore((s) => s.deviceActions.setVendorScreenData)
  const storedSetup = useOpenPLCStore((s) => s.deviceDefinitions.configuration.vendorScreenData?.[DEVICE_SETUP_KEY])
  const storedMapping = useOpenPLCStore((s) => s.deviceDefinitions.configuration.vendorScreenData?.[IO_MAPPING_KEY])
  const modules = useMemo(() => readModules(storedSetup), [storedSetup])
  const entries = useMemo(() => readEntries(storedMapping), [storedMapping])

  const handleAliasChange = (index: number, alias: string) => {
    const target = entries[index]
    if (!target) return
    const state = store.getState()
    const { configuration, pinMapping } = state.deviceDefinitions
    const pool = buildAddressPool(
      {
        pinMapping: { pins: pinMapping.pinsByBoard[configuration.deviceBoard] ?? [] },
        vendorIoMapping: { entries },
        remoteDevices: state.project.data.remoteDevices,
      },
      resolveTargetCapabilities(state.deviceAvailableOptions.availableBoards.get(configuration.deviceBoard)),
    )
    const validation = validateAliasEdit(buildAliasRegistry(pool), alias, {
      kind: 'vpp-io',
      ref: `slot-${target.slot}:${target.channelName}`,
    })
    if (!validation.ok) {
      const rejection = describeAliasRejection(validation, alias)
      toast({ title: rejection.title, description: rejection.description, variant: 'fail' })
      return
    }

    const oldAlias = target.alias ?? ''
    if (oldAlias) state.projectActions.renameAlias(oldAlias, alias)

    const updated = entries.map((entry, i) => (i === index ? { ...entry, alias } : entry))
    setVendorScreenData(IO_MAPPING_KEY, { entries: updated })
    store
      .getState()
      .projectActions.rememberChannelAlias(
        target.datapointId
          ? vppDatapointMemoryKey(target.datapointId)
          : vppMemoryKey(target.moduleId ?? '', target.slot, target.channelName),
        alias,
      )
  }

  if (modules.length === 0) {
    return (
      <p className='p-8 text-center text-sm text-neutral-500 dark:text-neutral-400'>
        No modules configured. Add modules in the I/O Configurator to generate I/O mappings.
      </p>
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      {modules.map((module) => {
        const channels = entries.flatMap((entry, index) => (entry.slot === module.slot ? [{ entry, index }] : []))
        return (
          <section
            key={module.guid}
            aria-label={`Slot ${module.slot} ${module.instanceName}`}
            className='overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700'
          >
            <header className='flex items-center gap-3 bg-neutral-50 px-4 py-2.5 dark:bg-neutral-900'>
              <span className='font-caption text-cp-sm font-semibold text-neutral-950 dark:text-white'>
                Slot {module.slot}
              </span>
              <span className='font-caption text-cp-sm font-medium text-neutral-600 dark:text-neutral-400'>
                {module.instanceName}
              </span>
            </header>
            {channels.length === 0 ? (
              <p className='border-t border-neutral-200 px-4 py-2 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400'>
                No addressable channels.
              </p>
            ) : (
              <table className='w-full text-left'>
                <thead>
                  <tr className='border-t border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-950'>
                    <th className={HEADER_CELL}>Channel</th>
                    <th className={HEADER_CELL}>Type</th>
                    <th className={HEADER_CELL}>IEC Address</th>
                    <th className={HEADER_CELL}>Alias</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map(({ entry, index }) => (
                    <tr
                      key={entry.datapointId ?? `${entry.slot}:${entry.channelName}`}
                      className='border-t border-neutral-100 dark:border-neutral-800'
                    >
                      <td className='px-3 py-1.5 font-caption text-cp-sm text-neutral-850 dark:text-neutral-300'>
                        {entry.channelName}
                      </td>
                      <td className='px-3 py-1.5 font-caption text-cp-sm text-neutral-500 dark:text-neutral-400'>
                        {entry.dataType ?? entry.channelType}
                      </td>
                      <td className='px-3 py-1.5 font-mono text-cp-sm font-medium text-brand dark:text-brand-light'>
                        {entry.iecAddress}
                      </td>
                      <td className='px-1 py-1'>
                        <AliasInputCell
                          value={entry.alias ?? ''}
                          label={`Alias of ${entry.channelName} in slot ${entry.slot}`}
                          onCommit={(next) => handleAliasChange(index, next)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )
      })}
    </div>
  )
}

export { DatapointIoTableLayout }
