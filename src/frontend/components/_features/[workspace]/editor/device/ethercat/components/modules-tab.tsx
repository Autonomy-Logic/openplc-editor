/**
 * Modules tab for a modular coupler.
 *
 * Mirrors the EtherCAT bus-editor Bus tab: Scan button and two side-by-side panels (Scanned
 * Modules on the left, Configured Modules on the right), add/remove/move actions on Configured
 * Modules, and a module-browser modal reached from the + button. Slots are 1-based; every change
 * is checked against the coupler's `<Slots>` block before it is applied.
 */

import { ArrowIcon } from '@root/frontend/assets/icons/interface/Arrow'
import { MinusIcon } from '@root/frontend/assets/icons/interface/Minus'
import { PlusIcon } from '@root/frontend/assets/icons/interface/Plus'
import { StickArrowIcon } from '@root/frontend/assets/icons/interface/StickArrow'
import TableActions from '@root/frontend/components/_atoms/table-actions'
import { toast } from '@root/frontend/components/_features/[app]/toast/use-toast'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@root/frontend/components/_molecules/modal'
import { useOpenPLCStore } from '@root/frontend/store'
import { cn } from '@root/frontend/utils/cn'
import { generateUniqueSlaveName } from '@root/frontend/utils/unique-slave-name'
import type {
  ConfiguredEtherCATDevice,
  ConfiguredEtherCATModule,
  ESIDevice,
  ESIModuleSummary,
  ESIRepositoryItemLight,
} from '@root/middleware/shared/ports/esi-types'
import { useEsi, useEtherCATScan } from '@root/middleware/shared/providers/platform-context'
import type { CouplerCompatibility, SlotIncrements } from '@root/middleware/shared/utils/ethercat'
import {
  buildModuleForSlot,
  canonicalVendorId,
  checkStation,
  identsEqual,
  isModuleCompatibleWithCoupler,
  removeModuleAndCompact,
  resolveEsiModule,
  shiftModule,
} from '@root/middleware/shared/utils/ethercat'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { DiscoveredModuleTable, type ScannedModuleMatch } from './discovered-module-table'
import { ModuleBrowserModal } from './module-browser-modal'

type ModulesTabProps = {
  device: ConfiguredEtherCATDevice
  busName: string
  repository: ESIRepositoryItemLight[]
  onUpdateModules: (modules: ConfiguredEtherCATModule[]) => void
  /**
   * IEC addresses claimed by every other producer in the project (pin mapping,
   * VPP I/O, Modbus TCP remote, other EtherCAT slaves). Fresh module channels
   * allocate around this set so they never collide with addresses already in
   * use elsewhere.
   */
  externalUsedAddresses: Set<string>
}

/**
 * Look up each scanned ident in the repository's module summaries. A module of the coupler's
 * vendor that no `<Slot>` definition accepts is reported as not accepted; an ident no ESI
 * carries, as missing.
 */
function matchScannedModules(
  scan: { slot: number; ident: string }[],
  repository: ESIRepositoryItemLight[],
  coupler: CouplerCompatibility,
): ScannedModuleMatch[] {
  return scan.map((s) => {
    let rejected: ESIModuleSummary | undefined
    for (const repoItem of repository) {
      if (canonicalVendorId(repoItem.vendor.id) !== canonicalVendorId(coupler.vendorId)) continue
      for (const found of repoItem.modules ?? []) {
        if (!identsEqual(found.ident, s.ident)) continue
        if (isModuleCompatibleWithCoupler(repoItem, found, coupler)) {
          return { slot: s.slot, ident: s.ident, match: { repoItem, module: found } }
        }
        rejected ??= found
      }
    }
    return rejected === undefined
      ? { slot: s.slot, ident: s.ident, match: null, unmatched: 'no-esi' }
      : { slot: s.slot, ident: s.ident, match: null, unmatched: 'not-accepted', candidateName: rejected.name }
  })
}

/** A module name no other module on the coupler has; module tabs are keyed by it. */
const uniqueModuleName = (base: string, others: readonly ConfiguredEtherCATModule[]): string =>
  generateUniqueSlaveName(base, (name) => others.some((m) => m.name === name))

export const ModulesTab = ({
  device,
  busName,
  repository,
  onUpdateModules,
  externalUsedAddresses,
}: ModulesTabProps) => {
  const esi = useEsi()
  const scanPort = useEtherCATScan()
  const [esiDevice, setEsiDevice] = useState<ESIDevice | null>(null)
  const [esiLoadError, setEsiLoadError] = useState<string | null>(null)

  // Scan state
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scannedModules, setScannedModules] = useState<{ slot: number; ident: string }[]>([])
  const [selectedScannedSlots, setSelectedScannedSlots] = useState<Set<number>>(new Set())

  // Configured state
  const [selectedConfiguredId, setSelectedConfiguredId] = useState<string | null>(null)
  const [isModuleBrowserOpen, setIsModuleBrowserOpen] = useState(false)
  const [unmatchedWarning, setUnmatchedWarning] = useState<ScannedModuleMatch[]>([])

  // The coupler's full ESI gives the slot increments and the `<Slots>` rules; nothing is added
  // until it has loaded.
  useEffect(() => {
    if (esi === undefined) return
    let cancelled = false
    setEsiDevice(null)
    setEsiLoadError(null)
    esi
      .loadDeviceFull(device.esiDeviceRef.repositoryItemId, device.esiDeviceRef.deviceIndex)
      .then((r) => {
        if (cancelled) return
        if (r.success) setEsiDevice(r.device)
        else setEsiLoadError(r.error)
      })
      .catch((err: unknown) => {
        if (!cancelled) setEsiLoadError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [esi, device.esiDeviceRef.repositoryItemId, device.esiDeviceRef.deviceIndex])

  const modules = useMemo(() => device.modules ?? [], [device.modules])
  const sortedConfigured = useMemo(() => [...modules].sort((a, b) => a.slot - b.slot), [modules])

  const slotsSpec = esiDevice?.slots ?? device.slotsSpec
  const increments = useMemo<SlotIncrements | null>(
    () =>
      slotsSpec === undefined
        ? null
        : { slotIndexIncrement: slotsSpec.slotIndexIncrement, slotPdoIncrement: slotsSpec.slotPdoIncrement },
    [slotsSpec],
  )
  const ready = esiDevice !== null && increments !== null

  const couplerCompatibility = useMemo<CouplerCompatibility>(
    () => ({ vendorId: device.vendorId, slots: slotsSpec }),
    [device.vendorId, slotsSpec],
  )

  const moduleMatches = useMemo(
    () => matchScannedModules(scannedModules, repository, couplerCompatibility),
    [scannedModules, repository, couplerCompatibility],
  )

  // Seed address allocation with everything claimed outside this slave plus the
  // addresses already used by this slave's existing modules. A new module adds
  // its own channels on top so later modules in the same batch don't collide.
  const buildUsedAddressSeed = useCallback((): Set<string> => {
    const seed = new Set(externalUsedAddresses)
    for (const existing of modules) {
      for (const m of existing.channelMappings) seed.add(m.iecLocation)
    }
    return seed
  }, [externalUsedAddresses, modules])

  /** Placement problems the station would have that concern `module`. */
  const placementProblems = useCallback(
    (station: readonly ConfiguredEtherCATModule[], module: ConfiguredEtherCATModule): string[] =>
      checkStation(slotsSpec, station)
        .filter((issue) => issue.kind === 'placement' && issue.module?.id === module.id)
        .map((issue) => issue.text),
    [slotsSpec],
  )

  const nextFreeSlot = useMemo(() => {
    const taken = new Set(modules.map((m) => m.slot))
    let slot = 1
    while (taken.has(slot)) slot += 1
    return slot
  }, [modules])

  const busInterface = useOpenPLCStore(
    (s) =>
      s.project.data.remoteDevices?.find((d) => d.name === busName)?.ethercatConfig?.masterConfig?.networkInterface,
  )

  const handleScan = useCallback(async () => {
    if (scanPort === undefined) {
      setScanError('Scan is not available on this platform.')
      return
    }
    setIsScanning(true)
    setScanError(null)
    try {
      const r = await scanPort.scanModules({
        busName,
        slavePosition: device.position ?? 1,
        networkInterface: busInterface,
      })
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
  }, [scanPort, busName, device.position, busInterface])

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
    const selected = moduleMatches.filter((m) => selectedScannedSlots.has(m.slot)).sort((a, b) => a.slot - b.slot)
    if (selected.length === 0 || esi === undefined || increments === null) return
    const esiPort = esi
    const unmatched = selected.filter((m) => m.match === null)
    const usedAddresses = buildUsedAddressSeed()
    let station = [...modules]
    const refused: string[] = []

    for (const m of selected) {
      if (m.match === null) continue
      const esiModule = await resolveEsiModule(esiPort, m.match.repoItem, m.ident)
      if (esiModule === undefined) {
        refused.push(`${m.match.module.name}: its ESI details could not be loaded`)
        continue
      }
      const replaced = station.find((x) => x.slot === m.slot)
      const others = station.filter((x) => x.slot !== m.slot)
      const fresh = buildModuleForSlot({
        id: replaced?.id ?? uuidv4(),
        slot: m.slot,
        esiModule,
        increments,
        repositoryItemId: m.match.repoItem.id,
        usedAddresses,
      })
      const built = { ...fresh, name: uniqueModuleName(fresh.name, others) }
      const candidate = [...others, built]
      const problems = placementProblems(candidate, built)
      if (problems.length > 0) {
        refused.push(`${built.name} (slot ${m.slot}): ${problems.join('; ')}`)
        continue
      }
      station = candidate
    }

    if (refused.length > 0) {
      toast({ title: 'Some modules were not added', description: refused.join('\n'), variant: 'fail' })
    }
    onUpdateModules(station)
    setSelectedScannedSlots(new Set())
    if (unmatched.length > 0) setUnmatchedWarning(unmatched)
  }, [
    moduleMatches,
    selectedScannedSlots,
    modules,
    esi,
    increments,
    onUpdateModules,
    buildUsedAddressSeed,
    placementProblems,
  ])

  const handleAddModuleFromBrowser = useCallback(
    async (modSummary: ESIModuleSummary, repoItem: ESIRepositoryItemLight) => {
      if (esi === undefined || increments === null) return
      const esiModule = await resolveEsiModule(esi, repoItem, modSummary.ident)
      if (esiModule === undefined) {
        // A module without its full ESI has no PDOs: it would map nothing on the wire.
        toast({
          title: 'Module not added',
          description: `No ESI details available for ${modSummary.name}. Load the module's ESI file into the repository and try again.`,
          variant: 'fail',
        })
        return
      }
      const fresh = buildModuleForSlot({
        id: uuidv4(),
        slot: nextFreeSlot,
        esiModule,
        increments,
        repositoryItemId: repoItem.id,
        usedAddresses: buildUsedAddressSeed(),
      })
      const built = { ...fresh, name: uniqueModuleName(fresh.name, modules) }
      const candidate = [...modules, built]
      const problems = placementProblems(candidate, built)
      if (problems.length > 0) {
        toast({ title: 'Module not added', description: `${built.name}: ${problems.join('; ')}`, variant: 'fail' })
        return
      }
      onUpdateModules(candidate)
    },
    [esi, modules, nextFreeSlot, onUpdateModules, increments, buildUsedAddressSeed, placementProblems],
  )

  const handleRemoveSelected = useCallback(() => {
    if (!selectedConfiguredId || increments === null) return
    onUpdateModules(removeModuleAndCompact(modules, selectedConfiguredId, increments))
    setSelectedConfiguredId(null)
  }, [selectedConfiguredId, modules, onUpdateModules, increments])

  const handleMove = useCallback(
    (direction: -1 | 1) => {
      if (!selectedConfiguredId || increments === null) return
      const next = shiftModule(modules, selectedConfiguredId, direction, increments)
      const problems = next.flatMap((m) => placementProblems(next, m))
      if (problems.length > 0) {
        toast({ title: 'Module not moved', description: problems.join('\n'), variant: 'fail' })
        return
      }
      onUpdateModules(next)
    },
    [selectedConfiguredId, modules, increments, onUpdateModules, placementProblems],
  )

  const selectedModule = modules.find((m) => m.id === selectedConfiguredId)
  const scanDisabled = isScanning || scanPort === undefined
  const addSelectedDisabled = selectedScannedSlots.size === 0 || !ready

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4'>
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

      {esiLoadError !== null && (
        <div className='rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20'>
          <p className='text-sm text-red-700 dark:text-red-300'>
            {`The coupler ESI could not be loaded, so modules cannot be added: ${esiLoadError}`}
          </p>
        </div>
      )}

      {scanError && (
        <div className='rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20'>
          <p className='text-sm text-red-700 dark:text-red-300'>{scanError}</p>
        </div>
      )}

      {/* Side-by-side panels — flex-1 so the panels fill the available Modules
          tab space and both sub-tables keep their own internal scrollbars. */}
      <div className='flex min-h-0 flex-1 gap-4'>
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
                  disabled: !ready,
                  icon: <PlusIcon className='h-4 w-4 stroke-brand' />,
                  id: 'add-ethercat-module-button',
                },
                {
                  ariaLabel: 'Remove Module',
                  onClick: handleRemoveSelected,
                  disabled: selectedModule === undefined || !ready,
                  icon: <MinusIcon className='h-4 w-4 stroke-brand' />,
                  id: 'remove-ethercat-module-button',
                },
                {
                  ariaLabel: 'Move Module Up',
                  onClick: () => handleMove(-1),
                  disabled: selectedModule === undefined || selectedModule.slot <= 1 || !ready,
                  icon: <StickArrowIcon direction='up' className='stroke-brand' />,
                  id: 'move-up-ethercat-module-button',
                },
                {
                  ariaLabel: 'Move Module Down',
                  onClick: () => handleMove(1),
                  disabled: selectedModule === undefined || !ready,
                  icon: <StickArrowIcon direction='down' className='stroke-brand' />,
                  id: 'move-down-ethercat-module-button',
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

      {/* Module browser — filtered to this coupler. Vendor is always a hard
          gate; when the coupler's `<Slots>` block names specific module idents
          or classes we tighten the gate to just those. */}
      <ModuleBrowserModal
        isOpen={isModuleBrowserOpen}
        onClose={() => setIsModuleBrowserOpen(false)}
        onSelectModule={(mod, repoItem) => void handleAddModuleFromBrowser(mod, repoItem)}
        repository={repository}
        coupler={{ ...couplerCompatibility, name: device.name }}
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
