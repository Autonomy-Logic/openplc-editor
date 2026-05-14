import { collectUsedIecAddresses } from '@root/backend/shared/utils/iec-address'
import { Checkbox } from '@root/frontend/components/_atoms/checkbox'
import { Label } from '@root/frontend/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/frontend/components/_atoms/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@root/frontend/components/_atoms/tooltip'
import { boardSelectors } from '@root/frontend/hooks/use-store-selectors'
import { useOpenPLCStore } from '@root/frontend/store'
import { generateIecAddress } from '@root/frontend/utils/iec-address'
import { getSectionPersistenceKey } from '@root/frontend/utils/vpp/persistence-keys'
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

  const [selectedSlot, setSelectedSlot] = useState(0)
  useEffect(() => {
    if (selectedSlot >= maxSlots) setSelectedSlot(0)
  }, [maxSlots, selectedSlot])

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
  const lastSlotsRef = useRef<string>('')
  useEffect(() => {
    const slotsKey = JSON.stringify(slots)
    if (slotsKey === lastSlotsRef.current) return
    lastSlotsRef.current = slotsKey

    const state = useOpenPLCStore.getState()
    const vsd = state.deviceDefinitions.configuration.vendorScreenData
    const storedMapping = vsd?.['io-mapping'] as { entries?: IoMappingEntry[] } | undefined
    const remoteDevices = (state.project.data.remoteDevices ?? []) as Array<{
      modbusTcpConfig?: { ioGroups?: Array<{ ioPoints: Array<{ iecLocation: string }> }> }
      ethercatConfig?: { devices?: Array<{ channelMappings?: Array<{ iecLocation: string }> }> }
    }>

    const existingAliases = new Map<string, string>()
    for (const entry of storedMapping?.entries ?? []) {
      if (entry.alias) existingAliases.set(`${entry.slot}:${entry.channelName}`, entry.alias)
    }

    const usedAddresses = collectUsedIecAddresses(remoteDevices)
    const newEntries: IoMappingEntry[] = []

    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const moduleId = slots[slotIndex]
      if (!moduleId) continue
      const moduleDef = availableModules.find((m) => m.id === moduleId)
      if (!moduleDef) continue
      const channels = (
        moduleDef as {
          addressMapping?: {
            channels?: Array<{ name: string; type: string; dataType: string; addressPrefix: string }>
          }
        }
      ).addressMapping?.channels
      if (!channels) continue

      for (const channel of channels) {
        const isBit = channel.addressPrefix === '%IX' || channel.addressPrefix === '%QX'
        const iecAddress = generateIecAddress(channel.addressPrefix, isBit, usedAddresses)
        usedAddresses.add(iecAddress)
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
  }, [slots])

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
          {(section.actions as Array<{ id: string; label: string; type: string; action?: string }>).map((action) =>
            action.type === 'local' && action.action === 'clear-module-slots' ? (
              <button
                key={action.id}
                type='button'
                onClick={handleClearAll}
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
          {slots.map((moduleId, idx) => {
            const mod = findModule(moduleId)
            const isSelected = idx === selectedSlot
            return (
              <button
                key={idx}
                type='button'
                onClick={() => setSelectedSlot(idx)}
                className={`flex shrink-0 flex-col gap-0.5 border-b border-neutral-100 px-3 py-2 text-left dark:border-neutral-800 ${
                  isSelected
                    ? 'bg-brand-light/20 dark:bg-brand-medium-dark/30'
                    : 'hover:bg-neutral-50 dark:hover:bg-neutral-900'
                }`}
              >
                <div className='flex items-center justify-between'>
                  <span className='font-caption text-cp-sm font-semibold text-neutral-950 dark:text-white'>
                    Slot {idx + 1}
                  </span>
                  {mod && (
                    <span className='text-[10px] text-neutral-400 dark:text-neutral-500'>{slotIoSummary(moduleId)}</span>
                  )}
                </div>
                <span
                  className={`truncate text-xs ${mod ? 'text-neutral-700 dark:text-neutral-300' : 'italic text-neutral-400 dark:text-neutral-600'}`}
                >
                  {mod?.name ?? 'Empty'}
                </span>
              </button>
            )
          })}
        </div>

        {/* ------ Right: contextual detail pane ------ */}
        <div className='flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto rounded-md border border-neutral-200 p-4 dark:border-neutral-700'>
          {/* Header: Slot title, module picker, description, specs
              on the left; module image fills the right column from
              the top of the card down to the end of the specs. */}
          <div className='mb-5 flex gap-5'>
            <div className='flex min-w-0 flex-1 flex-col'>
              <h3 className='mb-3 font-caption text-base font-semibold text-neutral-950 dark:text-white'>
                Slot {selectedSlot + 1}
              </h3>

              {/* Module picker — always visible. Selecting "-- Empty --"
                  clears the slot; selecting another module switches
                  in place without an intermediate clear step. */}
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
                    <SelectItem
                      value='__empty__'
                      className='flex w-full cursor-pointer items-center px-2 py-[6px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850'
                    >
                      <span className='font-caption text-cp-sm font-medium italic text-neutral-500 dark:text-neutral-400'>
                        -- Empty --
                      </span>
                    </SelectItem>
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

            {/* Module image — fixed width with a generous min-height,
                stretches further if the left text block grows past it
                via self-stretch. Sized to be the visual anchor of the
                slot card. */}
            {selectedModule && (
              <div className='flex min-h-72 w-96 shrink-0 items-center justify-center self-stretch overflow-hidden rounded-md border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900'>
                {moduleImage ? (
                  <img src={moduleImage} alt={selectedModule.name} className='h-full w-full object-contain' />
                ) : (
                  <span className='text-xs text-neutral-400 dark:text-neutral-600'>No image</span>
                )}
              </div>
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
        </div>
      </div>
    </div>
  )
}

export { ModuleSlotsLayout }
