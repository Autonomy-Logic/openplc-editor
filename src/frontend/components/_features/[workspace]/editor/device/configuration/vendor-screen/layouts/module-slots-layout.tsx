import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { buildAddressPool, nextFreeAddress } from '@root/backend/shared/utils/iec-address'
import { resolveTargetCapabilities } from '@root/backend/shared/utils/target-capabilities'
import { DragHandleIcon } from '@root/frontend/assets/icons/interface/DragHandle'
import { Checkbox } from '@root/frontend/components/_atoms/checkbox'
import { Label } from '@root/frontend/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/frontend/components/_atoms/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@root/frontend/components/_atoms/tooltip'
import { Modal, ModalContent, ModalTitle } from '@root/frontend/components/_molecules/modal'
import { boardSelectors } from '@root/frontend/hooks/use-store-selectors'
import { useOpenPLCStore } from '@root/frontend/store'
import { getSectionPersistenceKey } from '@root/frontend/utils/vpp/persistence-keys'
import { resolveModuleChannels, type ResolverModuleDef } from '@root/frontend/utils/vpp/resolve-module-channels'
import type { IoMappingEntry } from '@root/middleware/shared/ports/types'
import { useDevice } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ModuleDefinition, ModuleSystem, ScreenSection } from '../index'

// Same help glyph the HAL Settings form-layout uses, so per-field
// explanations live in a tooltip instead of cluttering the row.
function FieldHelpIcon({ text }: { text: string }) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label='Field help'
          className='inline-flex h-3.5 w-3.5 cursor-help select-none items-center justify-center rounded-full text-neutral-400 hover:text-neutral-600 focus:outline-none focus-visible:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300'
        >
          <svg viewBox='0 0 16 16' fill='none' className='h-3.5 w-3.5'>
            <circle cx='8' cy='8' r='7' stroke='currentColor' strokeWidth='1.5' />
            <path d='M8 7.25v4.25' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
            <circle cx='8' cy='4.75' r='0.85' fill='currentColor' />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent side='right' align='start' sideOffset={6} className='text-xs'>
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

type ModuleSlotsLayoutProps = {
  section: ScreenSection
  moduleSystem: ModuleSystem
}

type FieldValue = string | number | boolean
type SlotConfigMap = Record<string, Record<string, FieldValue>>
type ModuleConfigState = {
  slots?: (string | null)[]
  slotsConfig?: SlotConfigMap
}

type ConfigFieldDef = {
  id: string
  label: string
  type: string
  default?: FieldValue
  help?: string
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: Array<string | { value: string; label: string }>
  visible?: VisibleCondition
  encoding?: unknown
}

type VisibleCondition =
  | { condition: string; operator: string; value?: unknown }
  | { operator: 'and' | 'or'; conditions: VisibleCondition[] }

type ConfigScreenDefinition = {
  sections?: Array<{ id: string; title?: string; layout?: string; fields?: ConfigFieldDef[] }>
}

// Walk a screen definition and return every field that contributes
// to the configuration form. The screen JSON is a vendor artifact —
// be tolerant of missing/oddly-shaped fragments rather than crash.
function collectConfigFields(def: ConfigScreenDefinition | undefined | null): ConfigFieldDef[] {
  if (!def?.sections) return []
  const out: ConfigFieldDef[] = []
  for (const section of def.sections) {
    if (!section.fields) continue
    for (const f of section.fields) {
      if (f && typeof f === 'object' && typeof f.id === 'string') out.push(f)
    }
  }
  return out
}

function evalVisible(visible: VisibleCondition | undefined, values: Record<string, FieldValue>): boolean {
  if (!visible) return true
  if ('conditions' in visible) {
    const results = visible.conditions.map((c) => evalVisible(c, values))
    return visible.operator === 'and' ? results.every(Boolean) : results.some(Boolean)
  }
  const v = values[visible.condition]
  switch (visible.operator) {
    case 'equals':
      return v === visible.value
    case 'not-equals':
      return v !== visible.value
    case 'in':
      return Array.isArray(visible.value) && (visible.value as unknown[]).includes(v)
    case 'exists':
      return v !== undefined && v !== null && v !== ''
    case 'not-exists':
      return v === undefined || v === null || v === ''
    default:
      return true
  }
}

type SortableSlotButtonProps = {
  idx: number
  moduleName: string | undefined
  ioSummary: string
  isSelected: boolean
  draggable: boolean
  onSelect: () => void
}

/* One row in the slot list. Memberships in the DndContext are by row,
 * not by module — dragging shifts whatever module currently sits at
 * the source index to the target index. Empty slots are rendered but
 * not draggable: there's no module to move. */
function SortableSlotButton({ idx, moduleName, ioSummary, isSelected, draggable, onSelect }: SortableSlotButtonProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(idx),
    disabled: !draggable,
  })
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex shrink-0 items-stretch border-b border-neutral-100 dark:border-neutral-800 ${
        isSelected
          ? 'bg-brand/20 shadow-[inset_3px_0_0_var(--primary-default)] dark:bg-brand/30'
          : 'hover:bg-neutral-50 dark:hover:bg-neutral-900'
      }`}
    >
      {draggable ? (
        <button
          type='button'
          aria-label={`Drag slot ${idx + 1}`}
          {...attributes}
          {...listeners}
          tabIndex={-1}
          className='flex w-6 shrink-0 cursor-grab items-center justify-center text-neutral-400 hover:text-neutral-600 active:cursor-grabbing dark:text-neutral-500 dark:hover:text-neutral-300'
        >
          <DragHandleIcon className='h-4 w-4 fill-current' />
        </button>
      ) : (
        <div className='w-6 shrink-0' aria-hidden />
      )}
      <button
        type='button'
        aria-selected={isSelected}
        onClick={onSelect}
        className='flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-2 text-left'
      >
        <div className='flex items-center justify-between gap-2'>
          <span
            className={`font-caption text-cp-sm text-neutral-950 dark:text-white ${isSelected ? 'font-bold' : 'font-semibold'}`}
          >
            Slot {idx + 1}
          </span>
          {moduleName && (
            <span className='shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500'>{ioSummary}</span>
          )}
        </div>
        <span
          className={`truncate text-xs ${moduleName ? 'text-neutral-700 dark:text-neutral-300' : 'italic text-neutral-400 dark:text-neutral-600'} ${isSelected ? 'font-semibold' : ''}`}
        >
          {moduleName ?? 'Empty'}
        </span>
      </button>
    </div>
  )
}

function ModuleSlotsLayout({ section, moduleSystem }: ModuleSlotsLayoutProps) {
  const maxSlots = section.maxSlots || moduleSystem?.maxSlots || 8
  // Memoize so hooks depending on this don't fire every render.
  const availableModules = useMemo(() => moduleSystem?.modules ?? [], [moduleSystem])

  const vendorScreenData = useOpenPLCStore((s) => s.deviceDefinitions.configuration.vendorScreenData)
  const setVendorScreenData = useOpenPLCStore((s) => s.deviceActions.setVendorScreenData)
  const persistenceKey = getSectionPersistenceKey(section) ?? 'module-configuration'

  const moduleConfig = (vendorScreenData?.[persistenceKey] as ModuleConfigState | undefined) ?? {}
  const slots = useMemo(() => {
    const stored = moduleConfig.slots ?? []
    if (stored.length >= maxSlots) return stored.slice(0, maxSlots)
    return [...stored, ...Array<string | null>(maxSlots - stored.length).fill(null)]
  }, [moduleConfig.slots, maxSlots])
  const slotsConfig = useMemo(() => moduleConfig.slotsConfig ?? {}, [moduleConfig.slotsConfig])

  /* Stackable mode treats the backplane as a contiguous chain: empty
   * slots only exist at the tail, the user adds modules at the end,
   * and removing a module shifts the rest up so positions are always
   * dense. Physical (default) mode keeps the original behavior with
   * maxSlots fixed positions and the "-- Empty --" picker option. */
  const stackable = section.stackable === true
  const populatedCount = useMemo(() => {
    if (!stackable) return slots.length
    // In stackable mode the slot list should be dense, but tolerate
    // any nulls that snuck in by counting the prefix only.
    let n = 0
    for (const s of slots) {
      if (s === null) break
      n++
    }
    return n
  }, [slots, stackable])
  const displayedSlots = useMemo(() => {
    if (!stackable) return slots.map((_, idx) => idx)
    const out: number[] = []
    for (let i = 0; i < populatedCount; i++) out.push(i)
    return out
  }, [stackable, slots, populatedCount])

  const [selectedSlot, setSelectedSlot] = useState(0)
  useEffect(() => {
    if (selectedSlot >= maxSlots) setSelectedSlot(0)
  }, [maxSlots, selectedSlot])
  // In stackable mode, keep the selection inside the populated range.
  useEffect(() => {
    if (!stackable) return
    if (populatedCount === 0) {
      if (selectedSlot !== 0) setSelectedSlot(0)
    } else if (selectedSlot >= populatedCount) {
      setSelectedSlot(populatedCount - 1)
    }
  }, [stackable, populatedCount, selectedSlot])

  const [removeModalOpen, setRemoveModalOpen] = useState(false)
  const [clearAllModalOpen, setClearAllModalOpen] = useState(false)

  const findModule = useCallback(
    (id: string | null | undefined): ModuleDefinition | undefined =>
      id ? availableModules.find((m) => m.id === id) : undefined,
    [availableModules],
  )

  const selectedModuleId = slots[selectedSlot] ?? null
  const selectedModule = findModule(selectedModuleId)

  /* ------------------------------------------------------------ */
  /* Module image (lazy fetch via the SystemPort preview endpoint) */
  /* ------------------------------------------------------------ */
  const deviceBoard = boardSelectors.useDeviceBoard()
  const availableBoards = boardSelectors.useAvailableBoards()
  const packagePath = availableBoards.get(deviceBoard)?.vpp?.packagePath
  const devicePort = useDevice()
  const [moduleImage, setModuleImage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const imageRel = (selectedModule as { image?: string } | undefined)?.image
    if (!imageRel || !packagePath) {
      setModuleImage(null)
      return
    }
    void devicePort
      .getPreviewImage(imageRel, packagePath)
      .then((dataUrl: string) => {
        if (!cancelled) setModuleImage(dataUrl || null)
      })
      .catch(() => {
        if (!cancelled) setModuleImage(null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedModule, packagePath, devicePort])

  /* ------------------------------------------------------------ */
  /* I/O mapping regeneration                                      */
  /*                                                              */
  /* Mirrors the standalone io-table-layout: when the slot module */
  /* list changes, rebuild the IoMappingEntry[] (auto-assigned    */
  /* addresses) while preserving any user-typed aliases by        */
  /* slot:channel key. Writes to the 'io-mapping' persistence key */
  /* so the rest of the compile flow keeps reading the same data. */
  /* ------------------------------------------------------------ */
  // Re-allocate when the slot module list OR any format selector
  // (per-slot channelsByFormat resolver input) changes.
  const formatSelectionKey = useMemo(() => {
    return slots
      .map((moduleId, idx) => {
        if (!moduleId) return ''
        const md = availableModules.find((m) => m.id === moduleId) as ResolverModuleDef | undefined
        const fid = md?.addressMapping?.formatFieldId
        if (!fid) return ''
        const cfg = slotsConfig[String(idx + 1)] ?? {}
        const val = cfg[fid] ?? md?.addressMapping?.formatDefault ?? ''
        return `${idx}:${val}`
      })
      .join('|')
  }, [slots, slotsConfig, availableModules])

  const lastAllocKey = useRef<string>('')
  useEffect(() => {
    const allocKey = `${JSON.stringify(slots)}::${formatSelectionKey}`
    if (allocKey === lastAllocKey.current) return
    lastAllocKey.current = allocKey

    const state = useOpenPLCStore.getState()
    const vsd = state.deviceDefinitions.configuration.vendorScreenData
    const storedMapping = vsd?.['io-mapping'] as { entries?: IoMappingEntry[] } | undefined
    const remoteDevices = state.project.data.remoteDevices ?? []
    const boardInfo = state.deviceAvailableOptions.availableBoards.get(state.deviceDefinitions.configuration.deviceBoard)
    const capabilities = resolveTargetCapabilities(boardInfo)

    const existingAliases = new Map<string, string>()
    for (const entry of storedMapping?.entries ?? []) {
      if (entry.alias) existingAliases.set(`${entry.slot}:${entry.channelName}`, entry.alias)
    }

    // VPP slots are being regenerated, so the pool excludes the
    // current vpp-io claims and includes everything else (pin mapping,
    // modbus remote, EtherCAT) when active for the target.
    const pool = buildAddressPool(
      { pinMapping: { pins: state.deviceDefinitions.pinMapping.pins }, remoteDevices },
      capabilities,
      { ignoreSource: 'vpp-io' },
    )
    const inFlight = new Set<string>()
    const newEntries: IoMappingEntry[] = []

    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const moduleId = slots[slotIndex]
      if (!moduleId) continue
      const moduleDef = availableModules.find((m) => m.id === moduleId)
      if (!moduleDef) continue
      const slotConfig = slotsConfig[String(slotIndex + 1)] ?? {}
      const channels = resolveModuleChannels(moduleDef as ResolverModuleDef, slotConfig)
      if (channels.length === 0) continue

      for (const channel of channels) {
        const isBit = channel.addressPrefix === '%IX' || channel.addressPrefix === '%QX'
        const iecAddress = nextFreeAddress(pool, channel.addressPrefix, isBit, undefined, inFlight)
        inFlight.add(iecAddress)
        const aliasKey = `${slotIndex + 1}:${channel.name}`
        newEntries.push({
          slot: slotIndex + 1,
          moduleId,
          moduleName: moduleDef.name,
          channelName: channel.name,
          channelType: channel.type,
          dataType: channel.dataType,
          iecAddress,
          alias: existingAliases.get(aliasKey) ?? '',
        })
      }
    }

    setVendorScreenData('io-mapping', { entries: newEntries })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, formatSelectionKey])

  /* ------------------------------------------------------------ */
  /* Mutators                                                      */
  /* ------------------------------------------------------------ */
  const writeModuleConfig = (next: ModuleConfigState) => {
    setVendorScreenData(persistenceKey, next)
  }

  const handleSlotChange = (slotIndex: number, moduleId: string) => {
    const next = [...slots]
    next[slotIndex] = moduleId || null
    const nextConfig = { ...slotsConfig }
    if (!moduleId) delete nextConfig[String(slotIndex + 1)]
    writeModuleConfig({ ...moduleConfig, slots: next, slotsConfig: nextConfig })
  }

  const handleClearAll = () => {
    writeModuleConfig({ ...moduleConfig, slots: Array<string | null>(maxSlots).fill(null), slotsConfig: {} })
  }

  /* Stackable: append the first available module to the tail of the
   * populated range. The user can then change it via the dropdown. */
  const handleAddModule = () => {
    if (!stackable) return
    if (populatedCount >= maxSlots || availableModules.length === 0) return
    const targetIndex = populatedCount
    const next = [...slots]
    next[targetIndex] = availableModules[0].id
    writeModuleConfig({ ...moduleConfig, slots: next, slotsConfig })
    setSelectedSlot(targetIndex)
  }

  /* Drag-reorder the slot at `fromIdx` to `toIdx` using arrayMove
   * semantics — the dragged module lands at toIdx and everything in
   * between shifts by one. slotsConfig and io-mapping entries are
   * rewritten so per-slot config and aliases follow each module's
   * new position. The io-mapping reallocator will re-assign IEC
   * addresses on the next render in the new slot order. */
  const performReorderSlots = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return
    if (fromIdx < 0 || fromIdx >= slots.length) return
    if (toIdx < 0 || toIdx >= slots.length) return

    const nextSlots = arrayMove(slots, fromIdx, toIdx)

    // Build old-1based-slot -> new-1based-slot for the moved range.
    // Indices outside [min,max] of the move are unaffected.
    const lo = Math.min(fromIdx, toIdx)
    const hi = Math.max(fromIdx, toIdx)
    const remap = (slot1: number): number => {
      const i = slot1 - 1
      if (i < lo || i > hi) return slot1
      if (i === fromIdx) return toIdx + 1
      return (fromIdx < toIdx ? i - 1 : i + 1) + 1
    }

    const nextSlotsConfig: SlotConfigMap = {}
    for (const [key, value] of Object.entries(slotsConfig)) {
      const n = Number(key)
      if (Number.isNaN(n)) {
        nextSlotsConfig[key] = value
        continue
      }
      nextSlotsConfig[String(remap(n))] = value
    }
    writeModuleConfig({ ...moduleConfig, slots: nextSlots, slotsConfig: nextSlotsConfig })

    const vsd = useOpenPLCStore.getState().deviceDefinitions.configuration.vendorScreenData
    const entries = (vsd?.['io-mapping'] as { entries?: IoMappingEntry[] } | undefined)?.entries ?? []
    const shifted = entries.map((e) => ({ ...e, slot: remap(e.slot) }))
    setVendorScreenData('io-mapping', { entries: shifted })

    // Keep the focus on whichever module the user is currently looking at.
    if (selectedSlot === fromIdx) {
      setSelectedSlot(toIdx)
    } else if (fromIdx < selectedSlot && selectedSlot <= toIdx) {
      setSelectedSlot(selectedSlot - 1)
    } else if (toIdx <= selectedSlot && selectedSlot < fromIdx) {
      setSelectedSlot(selectedSlot + 1)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIdx = Number(active.id)
    const toIdx = Number(over.id)
    if (Number.isNaN(fromIdx) || Number.isNaN(toIdx)) return
    performReorderSlots(fromIdx, toIdx)
  }

  /* Stackable: drop the slot at `index` and shift every following slot
   * (modules + slot config + io-mapping entries + aliases) up by one
   * so positions stay dense. The io-mapping effect will re-allocate
   * addresses on the next render — preserving aliases via the
   * shifted entries it reads from the store. */
  const performRemoveModule = (index: number) => {
    if (!stackable) return
    if (index < 0 || index >= populatedCount) return

    const nextSlots = [...slots]
    for (let i = index; i < maxSlots - 1; i++) nextSlots[i] = nextSlots[i + 1] ?? null
    nextSlots[maxSlots - 1] = null

    const nextSlotsConfig: SlotConfigMap = {}
    for (const [key, value] of Object.entries(slotsConfig)) {
      const slotNum = Number(key)
      if (slotNum === index + 1) continue
      const newKey = slotNum > index + 1 ? String(slotNum - 1) : key
      nextSlotsConfig[newKey] = value
    }
    writeModuleConfig({ ...moduleConfig, slots: nextSlots, slotsConfig: nextSlotsConfig })

    // Rewrite io-mapping so the alias preservation effect finds the
    // shifted entries at their new slot numbers.
    const vsd = useOpenPLCStore.getState().deviceDefinitions.configuration.vendorScreenData
    const entries = (vsd?.['io-mapping'] as { entries?: IoMappingEntry[] } | undefined)?.entries ?? []
    const shifted = entries
      .filter((e) => e.slot !== index + 1)
      .map((e) => (e.slot > index + 1 ? { ...e, slot: e.slot - 1 } : e))
    setVendorScreenData('io-mapping', { entries: shifted })

    if (populatedCount > 1 && selectedSlot >= populatedCount - 1) {
      setSelectedSlot(populatedCount - 2)
    } else if (selectedSlot > index) {
      setSelectedSlot(selectedSlot - 1)
    }
  }

  const handleFieldChange = (slotIndex: number, fieldId: string, value: FieldValue) => {
    const key = String(slotIndex + 1)
    const slotValues = { ...(slotsConfig[key] ?? {}), [fieldId]: value }
    writeModuleConfig({
      ...moduleConfig,
      slots,
      slotsConfig: { ...slotsConfig, [key]: slotValues },
    })
  }

  const handleAliasChange = (slot: number, channelName: string, alias: string) => {
    const state = useOpenPLCStore.getState()
    const vsd = state.deviceDefinitions.configuration.vendorScreenData
    const entries = ((vsd?.['io-mapping'] as { entries?: IoMappingEntry[] } | undefined)?.entries ?? []).map((e) =>
      e.slot === slot && e.channelName === channelName ? { ...e, alias } : e,
    )
    setVendorScreenData('io-mapping', { entries })
  }

  /* ------------------------------------------------------------ */
  /* Config field values (with defaults)                           */
  /* ------------------------------------------------------------ */
  const configFields = useMemo(
    () => collectConfigFields(selectedModule?.configScreenDefinition as ConfigScreenDefinition | undefined),
    [selectedModule],
  )
  const slotValues: Record<string, FieldValue> = useMemo(() => {
    const stored = slotsConfig[String(selectedSlot + 1)] ?? {}
    const out: Record<string, FieldValue> = {}
    for (const f of configFields) {
      out[f.id] = stored[f.id] ?? (f.default as FieldValue) ?? ''
    }
    return out
  }, [configFields, slotsConfig, selectedSlot])

  /* ------------------------------------------------------------ */
  /* Render                                                        */
  /* ------------------------------------------------------------ */
  const slotIoSummary = (moduleId: string | null) => {
    if (!moduleId) return ''
    const mod = findModule(moduleId)
    if (!mod) return ''
    const parts: string[] = []
    if (mod.io.digitalInputs) parts.push(`${mod.io.digitalInputs}DI`)
    if (mod.io.digitalOutputs) parts.push(`${mod.io.digitalOutputs}DO`)
    if (mod.io.analogInputs) parts.push(`${mod.io.analogInputs}AI`)
    if (mod.io.analogOutputs) parts.push(`${mod.io.analogOutputs}AO`)
    return parts.join(' / ')
  }

  const ioEntriesForSelected = (() => {
    const entries = (vendorScreenData?.['io-mapping'] as { entries?: IoMappingEntry[] } | undefined)?.entries ?? []
    return entries.filter((e) => e.slot === selectedSlot + 1)
  })()

  return (
    // `flex-1 min-h-0` claims all available vertical space the parent
    // section grants us; both panes inside scroll independently so the
    // page-level container never needs to.
    <div className='flex min-h-0 flex-1 flex-col gap-3'>
      {/* Top-level actions (e.g. Clear All Slots) */}
      {section.actions && (
        <div className='flex gap-2'>
          {(
            section.actions as Array<{ id: string; label: string; type: string; action?: string; confirm?: string }>
          ).map((action) =>
            action.type === 'local' && action.action === 'clear-module-slots' ? (
              <button
                key={action.id}
                type='button'
                onClick={() => (action.confirm ? setClearAllModalOpen(true) : handleClearAll())}
                disabled={!slots.some((s) => s !== null)}
                className='rounded-md border border-neutral-200 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
              >
                {action.label}
              </button>
            ) : null,
          )}
        </div>
      )}

      <div className='flex min-h-0 flex-1 gap-4'>
        {/* ------ Left: slot tree ------ */}
        <div className='flex w-56 shrink-0 flex-col overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700'>
          <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={displayedSlots.map((idx) => String(idx))} strategy={verticalListSortingStrategy}>
              {displayedSlots.map((idx) => {
                const moduleId = slots[idx]
                const mod = findModule(moduleId)
                return (
                  <SortableSlotButton
                    key={idx}
                    idx={idx}
                    moduleName={mod?.name}
                    ioSummary={slotIoSummary(moduleId)}
                    isSelected={idx === selectedSlot}
                    draggable={!!mod}
                    onSelect={() => setSelectedSlot(idx)}
                  />
                )
              })}
            </SortableContext>
          </DndContext>
          {stackable && (
            <button
              type='button'
              onClick={handleAddModule}
              disabled={populatedCount >= maxSlots || availableModules.length === 0}
              className='flex shrink-0 items-center justify-center gap-1 border-t border-neutral-100 px-3 py-2 text-xs font-medium text-brand hover:bg-brand-light/10 disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:bg-transparent dark:border-neutral-800 dark:text-brand-light dark:hover:bg-brand-medium-dark/10 dark:disabled:text-neutral-600'
            >
              + Add module
            </button>
          )}
        </div>

        {/* ------ Right: contextual detail pane ------ */}
        <div className='flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto rounded-md border border-neutral-200 p-4 dark:border-neutral-700'>
        {stackable && populatedCount === 0 ? (
          <div className='flex flex-1 flex-col items-center justify-center text-center text-sm text-neutral-500 dark:text-neutral-400'>
            <p>No modules configured.</p>
            <p className='mt-1 text-xs'>Use &quot;+ Add module&quot; in the slot list to start a backplane.</p>
          </div>
        ) : (
          <>
          {/* Header: Slot title, module picker, description, specs
              on the left; module image fills the right column from
              the top of the card down to the end of the specs. */}
          <div className='mb-5 flex gap-5'>
            <div className='flex min-w-0 flex-1 flex-col'>
              <h3 className='mb-3 font-caption text-base font-semibold text-neutral-950 dark:text-white'>
                Slot {selectedSlot + 1}
              </h3>

              {/* Module picker — always visible. In physical mode,
                  selecting "-- Empty --" clears the slot; in stackable
                  mode there is no empty option and removal goes through
                  the Remove button so the remaining slots shift up. */}
              <div className='mb-4 flex items-center gap-3'>
                <Label className='w-20 shrink-0 text-xs font-medium text-neutral-950 dark:text-white'>Module</Label>
                <Select
                  value={selectedModule ? selectedModule.id : '__empty__'}
                  onValueChange={(v) => handleSlotChange(selectedSlot, v === '__empty__' ? '' : v)}
                >
                  <SelectTrigger
                    aria-label={`Module for slot ${selectedSlot + 1}`}
                    placeholder='-- Empty --'
                    withIndicator
                    className='flex h-[32px] w-80 items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-3 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                  />
                  <SelectContent
                    className='h-fit max-h-[280px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
                    sideOffset={5}
                    position='popper'
                    align='center'
                    side='bottom'
                  >
                    {!stackable && (
                      <SelectItem
                        value='__empty__'
                        className='flex w-full cursor-pointer items-center px-2 py-[6px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850'
                      >
                        <span className='font-caption text-cp-sm font-medium italic text-neutral-500 dark:text-neutral-400'>
                          -- Empty --
                        </span>
                      </SelectItem>
                    )}
                    {availableModules.map((mod) => (
                      <SelectItem
                        key={mod.id}
                        value={mod.id}
                        className='flex w-full cursor-pointer items-center px-2 py-[6px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850'
                      >
                        <span className='font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                          {mod.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {stackable && selectedModule && (
                  <button
                    type='button'
                    onClick={() => setRemoveModalOpen(true)}
                    className='rounded-md border border-neutral-200 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
                  >
                    Remove module
                  </button>
                )}
              </div>

              {selectedModule && (
                <>
                  {(selectedModule as { description?: string }).description && (
                    <p className='text-xs text-neutral-600 dark:text-neutral-400'>
                      {(selectedModule as { description?: string }).description}
                    </p>
                  )}
                  {(selectedModule as { specs?: Record<string, string> }).specs && (
                    <dl className='mt-2 flex flex-col gap-0.5 text-xs text-neutral-600 dark:text-neutral-400'>
                      {Object.entries((selectedModule as { specs?: Record<string, string> }).specs ?? {}).map(
                        ([k, v]) => (
                          <div key={k} className='flex gap-1'>
                            <dt className='font-medium text-neutral-500 dark:text-neutral-400'>{k}:</dt>
                            <dd className='text-neutral-700 dark:text-neutral-300'>{v}</dd>
                          </div>
                        ),
                      )}
                    </dl>
                  )}
                </>
              )}
            </div>

            {/* Module image — frameless. The PNGs ship with a
                transparent background, so no card chrome is needed. */}
            {selectedModule && moduleImage && (
              <img
                src={moduleImage}
                alt={selectedModule.name}
                className='h-80 w-80 shrink-0 self-start object-contain'
              />
            )}
          </div>

          {selectedModule ? (
            <div className='flex flex-col gap-5'>
              {/* I/O Mapping */}
              {ioEntriesForSelected.length > 0 && (
                <section>
                  <h4 className='mb-2 font-caption text-sm font-semibold text-neutral-950 dark:text-white'>
                    I/O Mapping
                  </h4>
                  <table className='w-full text-left'>
                    <thead>
                      <tr className='border-b border-neutral-200 dark:border-neutral-700'>
                        <th className='px-2 py-1.5 font-caption text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
                          Channel
                        </th>
                        <th className='px-2 py-1.5 font-caption text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
                          Type
                        </th>
                        <th className='px-2 py-1.5 font-caption text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
                          IEC Address
                        </th>
                        <th className='px-2 py-1.5 font-caption text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
                          Alias
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ioEntriesForSelected.map((entry) => (
                        <tr
                          key={`${entry.slot}-${entry.channelName}`}
                          className='border-b border-neutral-100 last:border-b-0 dark:border-neutral-800'
                        >
                          <td className='px-2 py-1.5 font-caption text-cp-sm text-neutral-850 dark:text-neutral-300'>
                            {entry.channelName}
                          </td>
                          <td className='px-2 py-1.5 font-caption text-cp-sm text-neutral-500 dark:text-neutral-400'>
                            {entry.channelType}
                          </td>
                          <td className='px-2 py-1.5 font-mono text-cp-sm font-medium text-brand dark:text-brand-light'>
                            {entry.iecAddress}
                          </td>
                          <td className='px-1 py-1'>
                            <input
                              type='text'
                              value={entry.alias}
                              onChange={(e) => handleAliasChange(entry.slot, entry.channelName, e.target.value)}
                              placeholder='Alias...'
                              className='h-[26px] w-full rounded border border-neutral-100 bg-white px-2 font-caption text-cp-sm text-neutral-850 outline-none placeholder:text-neutral-400 focus:border-brand-medium-dark dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300 dark:placeholder:text-neutral-600'
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {/* Defensive hint: manifest declared a configScreen path
                  but the parsed definition didn't reach us. Almost
                  always means an installed vpp predates the per-module
                  screens. Surface it instead of silently dropping the
                  config form. */}
              {(selectedModule as { configScreen?: string }).configScreen &&
                !(selectedModule as { configScreenDefinition?: unknown }).configScreenDefinition && (
                  <p className='rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300'>
                    This module ships a configuration screen but it could not be loaded. Reinstall the vendor package to
                    pick up the latest assets.
                  </p>
                )}

              {/* Configuration (only when this module has a configScreen).
                  TooltipProvider scopes the help-icon hover behaviour. */}
              {configFields.length > 0 && (
                <TooltipProvider>
                <section>
                  <h4 className='mb-2 font-caption text-sm font-semibold text-neutral-950 dark:text-white'>
                    Configuration
                  </h4>
                  <div className='flex flex-col gap-3'>
                    {configFields.map((field) => {
                      if (!evalVisible(field.visible, slotValues)) return null
                      const current = slotValues[field.id]
                      const setValue = (v: FieldValue) => handleFieldChange(selectedSlot, field.id, v)
                      return (
                        <div key={field.id} className='flex items-center gap-2'>
                          {field.type === 'boolean' ? (
                            <>
                              <Checkbox
                                id={`slot${selectedSlot + 1}-${field.id}`}
                                checked={current === true}
                                onCheckedChange={(c) => setValue(c as boolean)}
                                className={
                                  current === true
                                    ? 'h-[14px] w-[14px] border-brand'
                                    : 'h-[14px] w-[14px] border-neutral-300'
                                }
                              />
                              <Label
                                htmlFor={`slot${selectedSlot + 1}-${field.id}`}
                                className='text-xs text-neutral-950 dark:text-white'
                              >
                                {field.label}
                              </Label>
                            </>
                          ) : (
                            <>
                              <Label className='w-44 shrink-0 text-xs text-neutral-950 dark:text-white'>
                                {field.label}
                              </Label>
                              {field.type === 'number' ? (
                                <div className='flex items-center gap-1'>
                                  <input
                                    type='number'
                                    value={String(current ?? '')}
                                    min={field.min}
                                    max={field.max}
                                    step={field.step}
                                    onChange={(e) => setValue(Number(e.target.value))}
                                    className='flex h-[30px] w-32 items-center rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                                  />
                                  {field.unit && (
                                    <span className='text-xs text-neutral-500 dark:text-neutral-400'>{field.unit}</span>
                                  )}
                                </div>
                              ) : field.type === 'select' ? (
                                <Select value={String(current ?? '')} onValueChange={(v) => setValue(v)}>
                                  <SelectTrigger
                                    aria-label={field.label}
                                    placeholder='Select...'
                                    withIndicator
                                    className='flex h-[30px] w-64 items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                                  />
                                  <SelectContent
                                    className='h-fit max-h-[240px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
                                    sideOffset={5}
                                    position='popper'
                                    align='center'
                                    side='bottom'
                                  >
                                    {(field.options ?? []).map((opt) => {
                                      const v = typeof opt === 'string' ? opt : opt.value
                                      const l = typeof opt === 'string' ? opt : opt.label
                                      return (
                                        <SelectItem
                                          key={v}
                                          value={v}
                                          className='flex w-full cursor-pointer items-center px-2 py-[6px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850'
                                        >
                                          <span className='font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                                            {l}
                                          </span>
                                        </SelectItem>
                                      )
                                    })}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <input
                                  type='text'
                                  value={String(current ?? '')}
                                  onChange={(e) => setValue(e.target.value)}
                                  className='flex h-[30px] w-64 items-center rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                                />
                              )}
                            </>
                          )}
                          {field.help && <FieldHelpIcon text={field.help} />}
                        </div>
                      )
                    })}
                  </div>
                </section>
                </TooltipProvider>
              )}

            </div>
          ) : (
            /* Empty-slot state: nothing else to show — the always-
                visible Module picker above is the only action. */
            <p className='py-4 text-xs italic text-neutral-500 dark:text-neutral-400'>
              This slot is empty. Pick a module above to populate it.
            </p>
          )}
          </>
        )}
        </div>
      </div>

      {/* Remove-module confirmation (stackable only). All slots after
       *  the removed one shift up so positions stay dense; addresses
       *  are reallocated by the io-mapping effect. */}
      {stackable && (
        <Modal open={removeModalOpen} onOpenChange={setRemoveModalOpen}>
          <ModalContent className='flex w-[420px] select-none flex-col items-center justify-evenly gap-5 rounded-lg p-6'>
            <ModalTitle className='text-center font-caption text-base font-semibold text-neutral-950 dark:text-white'>
              Remove module from slot {selectedSlot + 1}?
            </ModalTitle>
            <p className='text-center text-sm text-neutral-600 dark:text-neutral-300'>
              {selectedModule ? <strong>{selectedModule.name}</strong> : 'This module'} will be removed and all
              following slots will shift up to keep the backplane contiguous. I/O addresses on the affected slots
              will be re-allocated.
            </p>
            <div className='flex w-full flex-col gap-2'>
              <button
                type='button'
                onClick={() => {
                  performRemoveModule(selectedSlot)
                  setRemoveModalOpen(false)
                }}
                className='w-full rounded-lg bg-red-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-red-700'
              >
                Remove module
              </button>
              <button
                type='button'
                onClick={() => setRemoveModalOpen(false)}
                className='w-full rounded-lg bg-neutral-100 px-4 py-2 text-center text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100 dark:hover:bg-neutral-800'
              >
                Cancel
              </button>
            </div>
          </ModalContent>
        </Modal>
      )}

      {/* Clear-all confirmation. Driven by the action's `confirm` field
       *  in the screen JSON — when present, the local button routes
       *  through here instead of firing immediately. */}
      <Modal open={clearAllModalOpen} onOpenChange={setClearAllModalOpen}>
        <ModalContent className='flex w-[420px] select-none flex-col items-center justify-evenly gap-5 rounded-lg p-6'>
          <ModalTitle className='text-center font-caption text-base font-semibold text-neutral-950 dark:text-white'>
            Clear all slots?
          </ModalTitle>
          <p className='text-center text-sm text-neutral-600 dark:text-neutral-300'>
            Every module will be removed from the backplane and the slot configuration cleared. I/O addresses
            allocated to those modules will be released.
          </p>
          <div className='flex w-full flex-col gap-2'>
            <button
              type='button'
              onClick={() => {
                handleClearAll()
                setClearAllModalOpen(false)
              }}
              className='w-full rounded-lg bg-red-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-red-700'
            >
              Clear all slots
            </button>
            <button
              type='button'
              onClick={() => setClearAllModalOpen(false)}
              className='w-full rounded-lg bg-neutral-100 px-4 py-2 text-center text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100 dark:hover:bg-neutral-800'
            >
              Cancel
            </button>
          </div>
        </ModalContent>
      </Modal>
    </div>
  )
}

export { ModuleSlotsLayout }
