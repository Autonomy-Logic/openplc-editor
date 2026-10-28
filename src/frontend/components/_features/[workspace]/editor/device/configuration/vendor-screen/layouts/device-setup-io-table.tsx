import { toast } from '@root/frontend/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore, useOpenPLCStoreApi } from '@root/frontend/store'
import { DEVICE_SETUP_KEY, IO_MAPPING_KEY, MODULE_CONFIGURATION_KEY } from '@root/frontend/utils/vpp/persistence-keys'
import type { IoMappingEntry } from '@root/middleware/shared/ports/types'
import {
  buildAddressPool,
  buildAliasRegistry,
  describeAliasRejection,
  validateAliasEdit,
} from '@root/middleware/shared/utils/iec-address'
import { vppMemoryKey } from '@root/middleware/shared/utils/iec-address/registry'
import { resolveAddressProducerCapabilities } from '@root/middleware/shared/utils/target-capabilities'
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
        'instanceName' in module &&
        typeof module.instanceName === 'string' &&
        'typeId' in module &&
        typeof module.typeId === 'string' &&
        'slot' in module &&
        typeof module.slot === 'number',
    )
    .sort((a, b) => a.slot - b.slot)
}

/** Manifest module id per slot, as the configurator snapshot wrote it; `null` where the type is not in the manifest. */
function readSlots(value: unknown): Array<string | null> {
  if (!value || typeof value !== 'object' || !('slots' in value) || !Array.isArray(value.slots)) return []
  return value.slots.map((slot: unknown) => (typeof slot === 'string' ? slot : null))
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
  /** Returns false when the alias was refused, so the input shows the stored value again. */
  onCommit: (next: string) => boolean
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
        if (local !== value && !onCommit(local)) setLocal(value)
      }}
      placeholder='Alias...'
      className='h-[26px] w-full rounded border border-neutral-100 bg-white px-2 font-caption text-cp-sm text-neutral-850 outline-none placeholder:text-neutral-400 focus:border-brand-medium-dark dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300 dark:placeholder:text-neutral-600'
    />
  )
}

const HEADER_CELL =
  'sticky top-10 z-10 bg-white px-3 py-1.5 dark:bg-neutral-950 font-caption text-[11px] font-medium text-neutral-500 dark:text-neutral-400'

/**
 * Read-only view of the station an embedded configurator reports: modules from
 * `device-setup`, channels from `io-mapping`. The station is edited only in the
 * configurator, so the Alias is the one thing this table writes.
 */
function DeviceSetupIoTable() {
  const store = useOpenPLCStoreApi()
  const setVendorScreenData = useOpenPLCStore((s) => s.deviceActions.setVendorScreenData)
  const storedSetup = useOpenPLCStore((s) => s.deviceDefinitions.configuration.vendorScreenData?.[DEVICE_SETUP_KEY])
  const storedMapping = useOpenPLCStore((s) => s.deviceDefinitions.configuration.vendorScreenData?.[IO_MAPPING_KEY])
  const storedSlots = useOpenPLCStore(
    (s) => s.deviceDefinitions.configuration.vendorScreenData?.[MODULE_CONFIGURATION_KEY],
  )
  const modules = useMemo(() => readModules(storedSetup), [storedSetup])
  const slots = useMemo(() => readSlots(storedSlots), [storedSlots])
  const entries = useMemo(() => readEntries(storedMapping), [storedMapping])

  const handleAliasChange = (index: number, alias: string): boolean => {
    const target = entries[index]
    if (!target) return false
    const state = store.getState()
    const { configuration, pinMapping } = state.deviceDefinitions
    const pool = buildAddressPool(
      {
        pinMapping: { pins: pinMapping.pinsByBoard[configuration.deviceBoard] ?? [] },
        vendorIoMapping: { entries },
        remoteDevices: state.project.data.remoteDevices,
      },
      resolveAddressProducerCapabilities(state.deviceAvailableOptions.availableBoards.get(configuration.deviceBoard)),
    )
    const validation = validateAliasEdit(buildAliasRegistry(pool), alias, {
      kind: 'vpp-io',
      ref: `slot-${target.slot}:${target.channelName}`,
    })
    if (!validation.ok) {
      const rejection = describeAliasRejection(validation, alias)
      toast({ title: rejection.title, description: rejection.description, variant: 'fail' })
      return false
    }

    const oldAlias = target.alias ?? ''
    if (oldAlias) state.projectActions.renameAlias(oldAlias, alias)

    const updated = entries.map((entry, i) => (i === index ? { ...entry, alias } : entry))
    setVendorScreenData(IO_MAPPING_KEY, {
      ...(storedMapping && typeof storedMapping === 'object' ? storedMapping : {}),
      entries: updated,
    })
    store
      .getState()
      .projectActions.rememberChannelAlias(vppMemoryKey(target.moduleId ?? '', target.slot, target.channelName), alias)
    return true
  }

  if (modules.length === 0) {
    return (
      <p className='p-8 text-center text-sm text-neutral-500 dark:text-neutral-400'>
        No modules configured. Add modules in Backplane Configuration to generate I/O mappings.
      </p>
    )
  }

  return (
    <>
      <div
        role='region'
        aria-label='I/O Mapping channels'
        tabIndex={0}
        className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto'
      >
        {modules.map((module) => {
          const channels = entries.flatMap((entry, index) => (entry.slot === module.slot ? [{ entry, index }] : []))
          const inCatalogue = typeof slots[module.slot - 1] === 'string'
          return (
            <section
              key={module.guid}
              aria-label={`Slot ${module.slot} ${module.instanceName}`}
              className='rounded-lg border border-neutral-200 dark:border-neutral-700'
            >
              <header className='sticky top-0 z-20 flex h-10 items-center gap-3 rounded-t-lg bg-neutral-50 px-4 dark:bg-neutral-900'>
                <span className='font-caption text-cp-sm font-semibold text-neutral-950 dark:text-white'>
                  Slot {module.slot}
                </span>
                <span className='font-caption text-cp-sm font-medium text-neutral-600 dark:text-neutral-400'>
                  {module.instanceName}
                </span>
                {!inCatalogue && (
                  <span className='rounded bg-amber-100 px-1.5 py-0.5 font-caption text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'>
                    Not in catalogue
                  </span>
                )}
              </header>
              {!inCatalogue ? (
                <p className='border-t border-neutral-200 px-4 py-2 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400'>
                  {`Module type ${module.typeId} is not in this package's catalogue, so it has no channels.`}
                </p>
              ) : channels.length === 0 ? (
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
                        key={`${entry.slot}:${entry.channelName}`}
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
    </>
  )
}

export { DeviceSetupIoTable }
