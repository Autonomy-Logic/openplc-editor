import { toast } from '@root/frontend/components/_features/[app]/toast/use-toast'
import { boardSelectors } from '@root/frontend/hooks/use-store-selectors'
import { useOpenPLCStore, useOpenPLCStoreApi } from '@root/frontend/store'
import { DEVICE_SETUP_KEY, IO_MAPPING_KEY, MODULE_CONFIGURATION_KEY } from '@root/frontend/utils/vpp/persistence-keys'
import type { IoMappingEntry, VppModuleDefinition } from '@root/middleware/shared/ports/types'
import {
  buildAddressPool,
  buildAliasRegistry,
  describeAliasRejection,
  validateAliasEdit,
} from '@root/middleware/shared/utils/iec-address'
import { vppMemoryKey } from '@root/middleware/shared/utils/iec-address/registry'
import { resolveAddressProducerCapabilities } from '@root/middleware/shared/utils/target-capabilities'
import { useMemo, useState } from 'react'

import { IoChannelTable } from '../components/io-channel-table'
import { ModulePicture, ModuleSummary, SlotDetailHeading, SlotDetailPane } from '../components/slot-detail'
import { SlotList, SlotListItem } from '../components/slot-list'
import { moduleIoSummary } from '../components/slot-list-helpers'

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

const EMPTY_CATALOGUE: VppModuleDefinition[] = []

function NotInCatalogueBadge() {
  return (
    <span className='shrink-0 rounded bg-amber-100 px-1.5 py-0.5 font-caption text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'>
      Not in catalogue
    </span>
  )
}

/**
 * Read-only view of the station an embedded configurator reports: modules from
 * `device-setup`, channels from `io-mapping`. The station is edited only in the
 * configurator, so the Alias is the one thing this screen writes.
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

  const deviceBoard = boardSelectors.useDeviceBoard()
  const vpp = boardSelectors.useAvailableBoards().get(deviceBoard)?.vpp
  const catalogue = vpp?.moduleSystem?.modules ?? EMPTY_CATALOGUE

  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
  const selected = modules.find((module) => module.slot === selectedSlot) ?? modules[0]

  const handleAliasChange = (target: IoMappingEntry, alias: string): boolean => {
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

    const updated = entries.map((entry) => (entry === target ? { ...entry, alias } : entry))
    setVendorScreenData(IO_MAPPING_KEY, {
      ...(storedMapping && typeof storedMapping === 'object' ? storedMapping : {}),
      entries: updated,
    })
    store
      .getState()
      .projectActions.rememberChannelAlias(vppMemoryKey(target.moduleId ?? '', target.slot, target.channelName), alias)
    return true
  }

  if (!selected) {
    return (
      <p className='p-8 text-center text-sm text-neutral-500 dark:text-neutral-400'>
        No modules configured. Add modules in Backplane Configuration to generate I/O mappings.
      </p>
    )
  }

  const definitionAt = (slot: number): VppModuleDefinition | undefined => {
    const id = slots[slot - 1]
    return typeof id === 'string' ? catalogue.find((definition) => definition.id === id) : undefined
  }
  const selectedDefinition = definitionAt(selected.slot)
  const selectedInCatalogue = typeof slots[selected.slot - 1] === 'string'
  const orderNumber = selectedDefinition?.specs?.orderNumber
  const channels = entries.filter((entry) => entry.slot === selected.slot)

  return (
    <div className='flex min-h-0 flex-1 gap-4'>
      <SlotList>
        {modules.map((module) => {
          const definition = definitionAt(module.slot)
          return (
            <SlotListItem
              key={module.guid}
              slotNumber={module.slot}
              moduleName={definition?.name ?? module.instanceName}
              ioSummary={definition ? moduleIoSummary(definition) : undefined}
              badge={typeof slots[module.slot - 1] === 'string' ? undefined : <NotInCatalogueBadge />}
              subtitle={definition ? module.instanceName : undefined}
              isSelected={module === selected}
              onSelect={() => setSelectedSlot(module.slot)}
            />
          )
        })}
      </SlotList>

      <SlotDetailPane>
        <section aria-label={`Slot ${selected.slot} ${selected.instanceName}`}>
          <div className='mb-5 flex gap-5'>
            <div className='flex min-w-0 flex-1 flex-col'>
              <SlotDetailHeading slotNumber={selected.slot} />
              <p className='font-caption text-sm font-medium text-neutral-850 dark:text-neutral-300'>
                {selectedDefinition?.name ?? selected.instanceName}
              </p>
              {orderNumber && <ModuleSummary specs={{ 'Order number': orderNumber }} />}
            </div>
            {selectedDefinition && (
              <ModulePicture
                image={selectedDefinition.image}
                packagePath={vpp?.packagePath}
                alt={selectedDefinition.name}
              />
            )}
          </div>

          {!selectedInCatalogue ? (
            <p className='text-sm text-neutral-500 dark:text-neutral-400'>
              {`Module type ${selected.typeId} is not in this package's catalogue, so it has no channels.`}
            </p>
          ) : channels.length === 0 ? (
            <p className='text-sm text-neutral-500 dark:text-neutral-400'>No addressable channels.</p>
          ) : (
            <IoChannelTable
              entries={channels}
              typeOf={(entry) => entry.dataType ?? entry.channelType}
              aliasLabel={(entry) => `Alias of ${entry.channelName} in slot ${entry.slot}`}
              onAliasCommit={handleAliasChange}
            />
          )}
        </section>
      </SlotDetailPane>
    </div>
  )
}

export { DeviceSetupIoTable }
