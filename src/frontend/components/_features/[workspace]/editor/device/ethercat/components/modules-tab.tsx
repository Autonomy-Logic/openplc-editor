/**
 * DOPE-704 E5 / E6 UI — Modules tab for a modular coupler.
 *
 * Mirrors the EtherCAT bus-editor Bus tab structure one-for-one: Scan button + two
 * side-by-side panels (Scanned Modules on the left, Configured Modules on the right),
 * +/- actions on Configured Modules, and a module-browser modal reached from the +
 * button. Scanned modules whose idents have no matching module in the repository are
 * labelled "No XML" and are not addable, exactly like unmatched scanned devices on the
 * bus screen.
 */

import { ArrowIcon } from '@root/frontend/assets/icons/interface/Arrow'
import { MinusIcon } from '@root/frontend/assets/icons/interface/Minus'
import { PlusIcon } from '@root/frontend/assets/icons/interface/Plus'
import TableActions from '@root/frontend/components/_atoms/table-actions'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@root/frontend/components/_molecules/modal'
import { cn } from '@root/frontend/utils/cn'
import type {
  ConfiguredEtherCATDevice,
  ConfiguredEtherCATModule,
  ESIDevice,
  ESIModule,
  ESIModuleSummary,
  ESIRepositoryItemLight,
  PersistedPdo,
  PersistedPdoEntry,
  SDOConfigurationEntry,
} from '@root/middleware/shared/ports/esi-types'
import { useEsi, useEtherCATScan } from '@root/middleware/shared/providers/platform-context'
import { canonicaliseIdent } from '@root/middleware/shared/utils/ethercat/scan-modules-protocol'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { DiscoveredModuleTable, type ScannedModuleMatch } from './discovered-module-table'
import { ModuleBrowserModal } from './module-browser-modal'

type ModulesTabProps = {
  device: ConfiguredEtherCATDevice
  busName: string
  repository: ESIRepositoryItemLight[]
  onUpdateModules: (modules: ConfiguredEtherCATModule[]) => void
}

/**
 * Slot-renumbered hex-add used when building a module from its ESI. Preserves the
 * leading-zero padding so indices stay readable in the project file.
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
 * Build a persisted module from a full ESIModule. Shared by both the manual add
 * (module browser) and the scan apply paths.
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

/**
 * Fallback for when the full ESIModule isn't available (external module file not loaded
 * yet). Produces the same shape without PDOs / SDOs; the operator finishes the module
 * through the Add Module from Repository flow after loading the ESI.
 */
function buildStubModuleForSlot(
  slot: number,
  ident: string,
  name: string,
  repoItemId: string,
): ConfiguredEtherCATModule {
  return {
    id: `slot-${slot}`,
    slot,
    name,
    ident,
    esiModuleRef: { repositoryItemId: repoItemId, moduleIdent: ident },
    channelMappings: [],
  }
}

/**
 * Look up each scanned ident in the repository's module summaries. First-match wins.
 */
function matchScannedModules(
  scan: { slot: number; ident: string }[],
  repository: ESIRepositoryItemLight[],
): ScannedModuleMatch[] {
  return scan.map((s) => {
    const identCanon = canonicaliseIdent(s.ident)
    for (const repoItem of repository) {
      const found = repoItem.modules?.find((m) => canonicaliseIdent(m.ident) === identCanon)
      if (found !== undefined) return { slot: s.slot, ident: s.ident, match: { repoItem, module: found } }
    }
    return { slot: s.slot, ident: s.ident, match: null }
  })
}

export const ModulesTab = ({ device, busName, repository, onUpdateModules }: ModulesTabProps) => {
  const esi = useEsi()
  const scanPort = useEtherCATScan()
  const [esiDevice, setEsiDevice] = useState<ESIDevice | null>(null)

  // Scan state
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scannedModules, setScannedModules] = useState<{ slot: number; ident: string }[]>([])
  const [selectedScannedSlots, setSelectedScannedSlots] = useState<Set<number>>(new Set())

  // Configured state
  const [selectedConfiguredId, setSelectedConfiguredId] = useState<string | null>(null)
  const [isModuleBrowserOpen, setIsModuleBrowserOpen] = useState(false)
  const [unmatchedWarning, setUnmatchedWarning] = useState<ScannedModuleMatch[]>([])

  // Load the coupler's full ESI once so we can read slotIndexIncrement / slotPdoIncrement
  // and resolve inline modules whose matches live on the coupler itself.
  useEffect(() => {
    let cancelled = false
    void esi!.loadDeviceFull(device.esiDeviceRef.repositoryItemId, device.esiDeviceRef.deviceIndex).then((r) => {
      if (cancelled) return
      if (r.success && r.device) setEsiDevice(r.device)
    })
    return () => {
      cancelled = true
    }
  }, [esi, device.esiDeviceRef.repositoryItemId, device.esiDeviceRef.deviceIndex])

  const modules = useMemo(() => device.modules ?? [], [device.modules])
  const sortedConfigured = useMemo(() => [...modules].sort((a, b) => a.slot - b.slot), [modules])

  const slotIndexIncrement = esiDevice?.slots?.slotIndexIncrement ?? 16
  const slotPdoIncrement = esiDevice?.slots?.slotPdoIncrement ?? 1

  const moduleMatches = useMemo(() => matchScannedModules(scannedModules, repository), [scannedModules, repository])

  const nextFreeSlot = useMemo(() => {
    const taken = new Set(modules.map((m) => m.slot))
    for (let s = 1; s <= 64; s++) if (!taken.has(s)) return s
    return modules.length + 1
  }, [modules])

  const handleScan = useCallback(async () => {
    if (scanPort === undefined) {
      setScanError('Scan is not available on this platform.')
      return
    }
    setIsScanning(true)
    setScanError(null)
    try {
      const r = await scanPort.scanModules({ busName, slavePosition: device.position ?? 1 })
      if (!r.success) {
        setScanError(r.error ?? 'Scan failed.')
        return
      }
      setScannedModules(r.scan.modules)
      setSelectedScannedSlots(new Set())
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsScanning(false)
    }
  }, [scanPort, busName, device.position])

  const handleSelectScannedSlot = useCallback((slot: number, selected: boolean) => {
    setSelectedScannedSlots((prev) => {
      const next = new Set(prev)
      if (selected) next.add(slot)
      else next.delete(slot)
      return next
    })
  }, [])

  const handleSelectAllScanned = useCallback(
    (selected: boolean) => {
      setSelectedScannedSlots(selected ? new Set(moduleMatches.map((m) => m.slot)) : new Set())
    },
    [moduleMatches],
  )

  const handleAddSelectedFromScan = useCallback(async () => {
    const selected = moduleMatches.filter((m) => selectedScannedSlots.has(m.slot))
    if (selected.length === 0) return
    const unmatched = selected.filter((m) => m.match === null)
    const matched = selected.filter((m) => m.match !== null)

    const existingBySlot = new Map(modules.map((m) => [m.slot, m]))

    // Load full ESIs for each repo item we need, so we can produce PDOs / SDOs.
    const loadedFull = new Map<string, ESIModule[] | null>()
    for (const m of matched) {
      if (!m.match) continue
      if (loadedFull.has(m.match.repoItem.id)) continue
      // Try each device in the repoItem - the ESI browser picks the first device.
      // For a standalone module file, there are no devices but modules live at the
      // top; we fall back to the stub.
      const esiModules: ESIModule[] = []
      for (let i = 0; i < m.match.repoItem.devices.length; i++) {
        try {
          const r = await esi!.loadDeviceFull(m.match.repoItem.id, i)
          if (r.success && r.device?.modules) esiModules.push(...r.device.modules)
        } catch {
          // ignore, fall back to stub
        }
      }
      loadedFull.set(m.match.repoItem.id, esiModules.length > 0 ? esiModules : null)
    }

    for (const m of matched) {
      if (!m.match) continue
      const esiModules = loadedFull.get(m.match.repoItem.id)
      const esiModule = esiModules?.find((em) => em.ident.toLowerCase() === m.ident.toLowerCase())
      const built =
        esiModule !== undefined
          ? buildModuleForSlot(m.slot, esiModule, slotIndexIncrement, slotPdoIncrement, m.match.repoItem.id)
          : buildStubModuleForSlot(m.slot, m.ident, m.match.module.name, m.match.repoItem.id)
      existingBySlot.set(m.slot, built)
    }

    onUpdateModules([...existingBySlot.values()])
    setSelectedScannedSlots(new Set())
    if (unmatched.length > 0) setUnmatchedWarning(unmatched)
  }, [moduleMatches, selectedScannedSlots, modules, esi, slotIndexIncrement, slotPdoIncrement, onUpdateModules])

  const handleAddModuleFromBrowser = useCallback(
    async (modSummary: ESIModuleSummary, repoItem: ESIRepositoryItemLight) => {
      let built: ConfiguredEtherCATModule
      // Try to load the full ESI module so the new row carries PDOs + SDOs.
      let esiModule: ESIModule | undefined
      for (let i = 0; i < repoItem.devices.length; i++) {
        try {
          const r = await esi!.loadDeviceFull(repoItem.id, i)
          const m = r.success
            ? r.device?.modules?.find((em) => em.ident.toLowerCase() === modSummary.ident.toLowerCase())
            : undefined
          if (m !== undefined) {
            esiModule = m
            break
          }
        } catch {
          // continue
        }
      }
      if (esiModule !== undefined) {
        built = buildModuleForSlot(nextFreeSlot, esiModule, slotIndexIncrement, slotPdoIncrement, repoItem.id)
      } else {
        built = buildStubModuleForSlot(nextFreeSlot, modSummary.ident, modSummary.name, repoItem.id)
      }
      onUpdateModules([...modules, built])
    },
    [esi, modules, nextFreeSlot, onUpdateModules, slotIndexIncrement, slotPdoIncrement],
  )

  const handleRemoveSelected = useCallback(() => {
    if (!selectedConfiguredId) return
    onUpdateModules(modules.filter((m) => m.id !== selectedConfiguredId))
    setSelectedConfiguredId(null)
  }, [selectedConfiguredId, modules, onUpdateModules])

  const scanDisabled = isScanning || scanPort === undefined
  const addSelectedDisabled = selectedScannedSlots.size === 0

  return (
    <div className='flex flex-col gap-4'>
      {/* Scan controls */}
      <div className='flex flex-wrap items-end gap-4'>
        <button
          onClick={() => void handleScan()}
          disabled={scanDisabled}
          className={cn(
            'flex h-[30px] items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors',
            'bg-brand text-white hover:bg-brand-medium-dark',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {isScanning ? (
            <>
              <ArrowIcon size='sm' className='animate-spin stroke-white' />
              Scanning...
            </>
          ) : (
            'Scan'
          )}
        </button>
      </div>

      {scanError && (
        <div className='rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20'>
          <p className='text-sm text-red-700 dark:text-red-300'>{scanError}</p>
        </div>
      )}

      {/* Side-by-side panels */}
      <div className='flex min-h-[480px] gap-4'>
        {/* Scanned Modules — left */}
        <div className='flex min-w-0 flex-1 flex-col'>
          <div className='mb-2 flex h-[28px] items-center justify-between'>
            <h3 className='text-sm font-medium text-neutral-950 dark:text-neutral-100'>Scanned Modules</h3>
            <button
              onClick={() => void handleAddSelectedFromScan()}
              disabled={addSelectedDisabled}
              className={cn(
                'flex h-7 items-center gap-2 rounded-md bg-brand px-3 text-xs font-medium text-white transition-colors',
                'hover:bg-brand-medium-dark',
                'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-brand',
              )}
            >
              {`Add Selected${selectedScannedSlots.size > 0 ? ` (${selectedScannedSlots.size})` : ''}`}
            </button>
          </div>
          <DiscoveredModuleTable
            moduleMatches={moduleMatches}
            selectedSlots={selectedScannedSlots}
            onSelectSlot={handleSelectScannedSlot}
            onSelectAll={handleSelectAllScanned}
            isScanning={isScanning}
          />
        </div>

        {/* Configured Modules — right */}
        <div className='flex min-w-0 flex-1 flex-col'>
          <div className='mb-2 flex h-[28px] items-center justify-between'>
            <h3 className='text-sm font-medium text-neutral-950 dark:text-neutral-100'>
              Configured Modules
              {sortedConfigured.length > 0 && (
                <span className='ml-1 font-normal text-neutral-500'>({sortedConfigured.length})</span>
              )}
            </h3>
            <TableActions
              actions={[
                {
                  ariaLabel: 'Add Module',
                  onClick: () => setIsModuleBrowserOpen(true),
                  icon: <PlusIcon className='h-4 w-4 stroke-brand' />,
                  id: 'add-ethercat-module-button',
                },
                {
                  ariaLabel: 'Remove Module',
                  onClick: handleRemoveSelected,
                  disabled: selectedConfiguredId === null,
                  icon: <MinusIcon className='h-4 w-4 stroke-brand' />,
                  id: 'remove-ethercat-module-button',
                },
              ]}
              buttonProps={{
                className:
                  'rounded-md p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed',
              }}
            />
          </div>

          <div className='flex-1 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800'>
            <table className='w-full'>
              <thead className='sticky top-0 bg-neutral-100 dark:bg-neutral-900'>
                <tr>
                  <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                    Slot
                  </th>
                  <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                    Name
                  </th>
                  <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                    Ident
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedConfigured.length === 0 ? (
                  <tr>
                    <td colSpan={3} className='px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400'>
                      No modules configured. Click + to add a module from the repository.
                    </td>
                  </tr>
                ) : (
                  sortedConfigured.map((m) => {
                    const isActive = m.id === selectedConfiguredId
                    return (
                      <tr
                        key={m.id}
                        onClick={() => setSelectedConfiguredId(isActive ? null : m.id)}
                        className={cn(
                          'cursor-pointer border-b border-neutral-200 transition-colors dark:border-neutral-800',
                          isActive
                            ? 'bg-brand/10 dark:bg-brand/20'
                            : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
                        )}
                      >
                        <td className='px-2 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300'>
                          {m.slot}
                        </td>
                        <td className='whitespace-nowrap px-2 py-2 text-sm font-medium text-neutral-950 dark:text-neutral-100'>
                          {m.name}
                        </td>
                        <td className='px-2 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400'>
                          {m.ident}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Module browser */}
      <ModuleBrowserModal
        isOpen={isModuleBrowserOpen}
        onClose={() => setIsModuleBrowserOpen(false)}
        onSelectModule={(mod, repoItem) => void handleAddModuleFromBrowser(mod, repoItem)}
        repository={repository}
      />

      {/* Unmatched-scanned-module warning (same shape as the bus-screen warning) */}
      <Modal open={unmatchedWarning.length > 0} onOpenChange={(open) => !open && setUnmatchedWarning([])}>
        <ModalContent
          onClose={() => setUnmatchedWarning([])}
          className='!inset-x-0 !bottom-auto !top-1/2 !h-auto max-h-[80vh] w-[480px] !-translate-y-1/2 p-6'
        >
          <ModalHeader>
            <ModalTitle>Missing ESI XML for some modules</ModalTitle>
          </ModalHeader>
          <p className='text-sm text-neutral-700 dark:text-neutral-300'>
            {unmatchedWarning.length === 1
              ? 'The module below could not be added because its ESI XML is not in the repository.'
              : `${unmatchedWarning.length} modules could not be added because their ESI XML is not in the repository.`}
          </p>
          <div className='max-h-[260px] overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800'>
            <table className='w-full text-sm'>
              <thead className='sticky top-0 bg-neutral-100 dark:bg-neutral-900'>
                <tr>
                  <th className='px-3 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                    Slot
                  </th>
                  <th className='px-3 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                    Ident
                  </th>
                </tr>
              </thead>
              <tbody>
                {unmatchedWarning.map((m) => (
                  <tr key={m.slot} className='border-t border-neutral-200 dark:border-neutral-800'>
                    <td className='px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300'>{m.slot}</td>
                    <td className='px-3 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400'>{m.ident}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ModalFooter className='flex justify-end gap-2 pt-3'>
            <button
              onClick={() => setUnmatchedWarning([])}
              className='rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
            >
              Close
            </button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
