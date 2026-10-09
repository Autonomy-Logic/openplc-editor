/**
 * DOPE-704 E5 UI — Modules tab for a modular coupler.
 *
 * Lists the modules currently configured for the coupler (slot, name, ident, channel
 * count, startup SDO count) and offers an "Add module" dialog that picks a slot number
 * and a module from the coupler's ESI-declared `<Modules>` block.
 *
 * On add, the module's RxPDOs and TxPDOs are copied with slot-adjusted indices
 * (base + (slot-1) * slotPdoIncrement for PDO indices, base + (slot-1) *
 * slotIndexIncrement for SDO object indices), and the module's `InitCmd`s are copied
 * into the module's `sdoConfigurations`. The on-wire effect comes through
 * `buildModulePdos` + `buildModuleStartupSdos` + `buildModuleIdentListWrites` (E5
 * generator); the UI only produces the persisted shape.
 *
 * The module's own channel mappings start empty: the operator maps them to IEC
 * addresses in a follow-up pass through the ChannelMappings table on the coupler.
 */

import { Checkbox } from '@root/frontend/components/_atoms/checkbox'
import { InputWithRef } from '@root/frontend/components/_atoms/input'
import { cn } from '@root/frontend/utils/cn'
import type {
  ConfiguredEtherCATDevice,
  ConfiguredEtherCATModule,
  ESIDevice,
  ESIModule,
  PersistedPdo,
  PersistedPdoEntry,
  SDOConfigurationEntry,
} from '@root/middleware/shared/ports/esi-types'
import { useEsi } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useMemo, useState } from 'react'

type ModulesTabProps = {
  device: ConfiguredEtherCATDevice
  onUpdateModules: (modules: ConfiguredEtherCATModule[]) => void
}

/**
 * Hex add with leading-zero padding preserved. Keeps the "0x" / "0X" prefix if any.
 * The ESI expresses PDO and object indices in hex, so slot renumbering stays in hex.
 */
function hexAdd(hexIndex: string, delta: number): string {
  const match = hexIndex.match(/^(0[xX])?([0-9a-fA-F]+)$/)
  if (match === null) return hexIndex
  const prefix = match[1] ?? '0x'
  const digits = match[2]
  const value = parseInt(digits, 16) + delta
  const padded = value.toString(16).toUpperCase().padStart(digits.length, '0')
  return `${prefix}${padded}`
}

/**
 * Builds a `ConfiguredEtherCATModule` from an `ESIModule` picked for a slot, applying
 * the slot renumbering rules from `ESISlotsSpec`. Pure — the caller merges it onto
 * `device.modules`.
 */
function buildModuleForSlot(
  slot: number,
  esiModule: ESIModule,
  slotIndexIncrement: number,
  slotPdoIncrement: number,
  esiRepositoryItemId: string,
): ConfiguredEtherCATModule {
  const slotOffset = slot - 1
  const indexDelta = slotOffset * slotIndexIncrement
  const pdoDelta = slotOffset * slotPdoIncrement

  const persistPdo = (pdos: ESIModule['rxPdo']): PersistedPdo[] =>
    pdos.map((pdo) => ({
      index: hexAdd(pdo.index, pdoDelta),
      name: pdo.name,
      assigned: true,
      fixed: pdo.fixed || undefined,
      mandatory: pdo.mandatory || undefined,
      sm: pdo.smIndex,
      entries: pdo.entries.map(
        (entry): PersistedPdoEntry => ({
          index: hexAdd(entry.index, indexDelta),
          subIndex: entry.subIndex,
          bitLen: entry.bitLen,
          name: entry.name,
          dataType: entry.dataType,
        }),
      ),
    }))

  /** DataAscii → hex. Preserves the raw bytes the generator forwards to EtherDOG. */
  const asciiToHex = (ascii: string): string =>
    Array.from(ascii)
      .map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase())
      .join('')

  const sdoFromInitCmds: SDOConfigurationEntry[] = esiModule.initCmds.map((cmd) => {
    const bytesHex = cmd.dataAscii !== undefined ? asciiToHex(cmd.dataAscii) : undefined
    const byteLen = bytesHex !== undefined ? bytesHex.length / 2 : 0
    const numericValue = cmd.value !== undefined ? String(cmd.value) : (cmd.data ?? '')
    return {
      index: hexAdd(cmd.index, indexDelta),
      subIndex: cmd.subIndex,
      value: bytesHex !== undefined ? '' : numericValue,
      valueBytes: bytesHex,
      completeAccess: cmd.completeAccess,
      defaultValue: numericValue,
      dataType: bytesHex !== undefined ? 'OCTET_STRING' : (cmd.dataType ?? 'UDINT'),
      bitLength: bytesHex !== undefined ? byteLen * 8 : 32,
      name: cmd.comment ?? cmd.index,
      objectName: `Module slot ${slot} InitCmd`,
    }
  })

  return {
    id: `slot-${slot}`,
    slot,
    name: esiModule.name,
    ident: esiModule.ident,
    esiModuleRef: { repositoryItemId: esiRepositoryItemId, moduleIdent: esiModule.ident },
    channelMappings: [],
    rxPdos: persistPdo(esiModule.rxPdo),
    txPdos: persistPdo(esiModule.txPdo),
    sdoConfigurations: sdoFromInitCmds.length > 0 ? sdoFromInitCmds : undefined,
  }
}

const AddModuleDialog = ({
  esiDevice,
  esiRepositoryItemId,
  existingModules,
  onAdd,
  onCancel,
}: {
  esiDevice: ESIDevice
  esiRepositoryItemId: string
  existingModules: ConfiguredEtherCATModule[]
  onAdd: (module: ConfiguredEtherCATModule) => void
  onCancel: () => void
}) => {
  const takenSlots = useMemo(() => new Set(existingModules.map((m) => m.slot)), [existingModules])
  const nextFreeSlot = useMemo(() => {
    for (let s = 1; s <= 64; s++) if (!takenSlots.has(s)) return s
    return 1
  }, [takenSlots])
  const [slot, setSlot] = useState<number>(nextFreeSlot)
  const [moduleIdent, setModuleIdent] = useState<string>(esiDevice.modules?.[0]?.ident ?? '')

  const picked = useMemo(
    () => esiDevice.modules?.find((m) => m.ident === moduleIdent),
    [esiDevice.modules, moduleIdent],
  )

  const slotIndexIncrement = esiDevice.slots?.slotIndexIncrement ?? 16
  const slotPdoIncrement = esiDevice.slots?.slotPdoIncrement ?? 1
  const slotCollision = takenSlots.has(slot)
  const canAdd = picked !== undefined && !slotCollision && slot > 0

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='w-full max-w-md rounded-lg border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900'>
        <h3 className='mb-3 text-sm font-semibold text-neutral-800 dark:text-neutral-200'>Add module to coupler</h3>

        <div className='mb-3 flex flex-col gap-2'>
          <label className='flex items-center gap-3 text-xs text-neutral-700 dark:text-neutral-300'>
            <span className='w-20'>Slot</span>
            <InputWithRef
              type='number'
              value={slot}
              min={1}
              max={esiDevice.slots?.maxSlotCount ?? 64}
              onChange={(e) => setSlot(parseInt(e.target.value, 10) || 1)}
              className='h-7 w-20 rounded-md border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-950'
            />
            {slotCollision && <span className='text-xs text-red-600 dark:text-red-400'>Already in use.</span>}
          </label>
          <label className='flex items-center gap-3 text-xs text-neutral-700 dark:text-neutral-300'>
            <span className='w-20'>Module</span>
            <select
              value={moduleIdent}
              onChange={(e) => setModuleIdent(e.target.value)}
              className='h-7 flex-1 rounded-md border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-950'
            >
              {(esiDevice.modules ?? []).map((m) => (
                <option key={m.ident} value={m.ident}>
                  {m.name} ({m.ident})
                </option>
              ))}
            </select>
          </label>
          {picked !== undefined && (
            <p className='text-[11px] text-neutral-500 dark:text-neutral-400'>
              {picked.rxPdo.length} RxPDO{picked.rxPdo.length === 1 ? '' : 's'} / {picked.txPdo.length} TxPDO
              {picked.txPdo.length === 1 ? '' : 's'} / {picked.initCmds.length} InitCmd
              {picked.initCmds.length === 1 ? '' : 's'}
            </p>
          )}
        </div>

        <div className='flex items-center justify-end gap-2'>
          <button
            type='button'
            onClick={onCancel}
            className='rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
          >
            Cancel
          </button>
          <button
            type='button'
            disabled={!canAdd}
            onClick={() => {
              if (!canAdd || picked === undefined) return
              onAdd(buildModuleForSlot(slot, picked, slotIndexIncrement, slotPdoIncrement, esiRepositoryItemId))
            }}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium text-white',
              canAdd ? 'bg-brand hover:bg-brand-medium-dark' : 'cursor-not-allowed bg-neutral-400',
            )}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

export const ModulesTab = ({ device, onUpdateModules }: ModulesTabProps) => {
  const esi = useEsi()
  const [esiDevice, setEsiDevice] = useState<ESIDevice | null>(null)
  const [loadingEsi, setLoadingEsi] = useState(false)
  const [esiError, setEsiError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingEsi(true)
    setEsiError(null)
    void esi!
      .loadDeviceFull(device.esiDeviceRef.repositoryItemId, device.esiDeviceRef.deviceIndex)
      .then((r) => {
        if (cancelled) return
        if (r.success && r.device) setEsiDevice(r.device)
        else setEsiError(!r.success ? (r.error ?? 'Failed') : 'Failed to load ESI device')
      })
      .finally(() => {
        if (!cancelled) setLoadingEsi(false)
      })
    return () => {
      cancelled = true
    }
  }, [esi, device.esiDeviceRef.repositoryItemId, device.esiDeviceRef.deviceIndex])

  const modules = device.modules ?? []
  const sorted = useMemo(() => [...modules].sort((a, b) => a.slot - b.slot), [modules])

  const handleAdd = useCallback(
    (module: ConfiguredEtherCATModule) => {
      onUpdateModules([...modules, module])
      setAdding(false)
    },
    [modules, onUpdateModules],
  )

  const handleRemove = useCallback(
    (moduleId: string) => {
      onUpdateModules(modules.filter((m) => m.id !== moduleId))
    },
    [modules, onUpdateModules],
  )

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h5 className='text-sm font-semibold text-neutral-800 dark:text-neutral-200'>Modules</h5>
          <p className='mt-0.5 text-xs text-neutral-500 dark:text-neutral-400'>
            Modules plugged into this coupler. Each slot renumbers the module&rsquo;s PDOs and SDO indices through{' '}
            <code className='font-mono'>SlotPdoIncrement</code> / <code className='font-mono'>SlotIndexIncrement</code>.
          </p>
        </div>
        <button
          type='button'
          onClick={() => setAdding(true)}
          disabled={esiDevice === null || (esiDevice.modules ?? []).length === 0}
          className={cn(
            'rounded-md bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-medium-dark',
            (esiDevice === null || (esiDevice.modules ?? []).length === 0) &&
              'cursor-not-allowed bg-neutral-400 hover:bg-neutral-400',
          )}
        >
          Add module
        </button>
      </div>

      {loadingEsi && <p className='text-xs text-neutral-500 dark:text-neutral-400'>Loading ESI&hellip;</p>}
      {esiError !== null && <p className='text-xs text-red-600 dark:text-red-400'>{esiError}</p>}

      {sorted.length === 0 ? (
        <p className='rounded-md border border-dashed border-neutral-300 p-6 text-center text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400'>
          No modules on this coupler yet.{' '}
          {esiDevice !== null && (esiDevice.modules ?? []).length > 0
            ? 'Click Add module to pick one.'
            : 'The coupler ESI declares no modules.'}
        </p>
      ) : (
        <div className='overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800'>
          <table className='w-full'>
            <thead className='bg-neutral-50 text-left dark:bg-neutral-900'>
              <tr>
                <th className='px-2 py-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>Slot</th>
                <th className='px-2 py-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>Name</th>
                <th className='px-2 py-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>Ident</th>
                <th className='px-2 py-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>PDOs</th>
                <th className='px-2 py-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>SDOs</th>
                <th className='px-2 py-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>Mapped</th>
                <th className='px-2 py-1.5 text-right text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => {
                const pdoCount = (m.rxPdos?.length ?? 0) + (m.txPdos?.length ?? 0)
                const sdoCount = m.sdoConfigurations?.length ?? 0
                return (
                  <tr key={m.id} className='border-b border-neutral-100 last:border-b-0 dark:border-neutral-800'>
                    <td className='px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300'>{m.slot}</td>
                    <td className='px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300'>{m.name}</td>
                    <td className='px-2 py-1.5 font-mono text-xs text-neutral-500 dark:text-neutral-400'>{m.ident}</td>
                    <td className='px-2 py-1.5 text-xs text-neutral-500 dark:text-neutral-400'>{pdoCount}</td>
                    <td className='px-2 py-1.5 text-xs text-neutral-500 dark:text-neutral-400'>{sdoCount}</td>
                    <td className='px-2 py-1.5 text-xs text-neutral-500 dark:text-neutral-400'>
                      <Checkbox checked={m.channelMappings.length > 0} disabled aria-label='has mappings' />
                    </td>
                    <td className='px-2 py-1.5 text-right'>
                      <button
                        type='button'
                        onClick={() => handleRemove(m.id)}
                        className='text-xs text-red-600 hover:underline dark:text-red-400'
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && esiDevice !== null && (
        <AddModuleDialog
          esiDevice={esiDevice}
          esiRepositoryItemId={device.esiDeviceRef.repositoryItemId}
          existingModules={modules}
          onAdd={handleAdd}
          onCancel={() => setAdding(false)}
        />
      )}
    </div>
  )
}
