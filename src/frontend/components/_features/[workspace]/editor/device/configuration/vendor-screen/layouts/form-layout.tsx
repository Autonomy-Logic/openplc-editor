import { Label } from '@root/frontend/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/frontend/components/_atoms/select'
import { ToggleSwitch } from '@root/frontend/components/_atoms/toggle-switch'
import { FieldHelpIcon, TooltipProvider } from '@root/frontend/components/_atoms/tooltip'
import { useOpenPLCStore } from '@root/frontend/store'
import { evalVisible, type VisibleCondition } from '@root/frontend/utils/vpp/eval-visible'
import { resolveFieldOptions } from '@root/frontend/utils/vpp/field-options'
import { UART_PIN_MAP_FIELD_TYPE } from '@root/middleware/shared/utils/modbus-master-profile'
import { useEffect } from 'react'

import { UartPinMapField } from '../components/uart-pin-map-field'
import type { ScreenSection } from '../index'
import { useSectionStorage } from '../use-section-storage'

type FieldDef = {
  id: string
  label: string
  type: string
  default?: unknown
  min?: number
  max?: number
  step?: number
  unit?: string
  help?: string
  options?: string[] | Array<{ value: string; label: string }>
  // Dynamic option source (VPP screen schema): a dotted path resolved against
  // per-board context, e.g. "board.serialPorts". Wins over `options` when it
  // resolves to a non-empty array; otherwise `options` is the fallback.
  optionsRef?: string
  // Honored by text-like inputs (text, password, ip-address, mac-address).
  // Mirrors the VPP screen schema's optional field props — empty strings
  // are skipped so HTML5 placeholder/maxLength/pattern stay unset when
  // the screen author didn't supply them.
  placeholder?: string
  maxLength?: number
  validation?: string
  // Optional storage-key override.
  persistAs?: string
  // Optional conditional-visibility clause (VPP screen schema).
  visible?: VisibleCondition
}

function storageKeyFor(field: FieldDef): string {
  return field.persistAs && field.persistAs.length > 0 ? field.persistAs : field.id
}

// Shared input styling for every <input> branch (text, number, password, ip-address, mac-address).
const TEXT_INPUT_CLASS =
  'flex h-[30px] w-48 items-center rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

/** The field types this layout knows how to render. */
const SUPPORTED_FIELD_TYPES = new Set([
  'boolean',
  'number',
  'select',
  'password',
  'ip-address',
  'mac-address',
  'text',
  UART_PIN_MAP_FIELD_TYPE,
])

// Anchor-less HTML5 patterns for the formatted text types. The schema's
// per-field `validation` (when present) is more specific and wins via the
// runtime override below, but these defaults give a sensible UX hint when
// the screen author didn't ship a regex.
const IPV4_PATTERN = '^(\\d{1,3}\\.){3}\\d{1,3}$'
const MAC_PATTERN = '^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$'

type FormLayoutProps = {
  section: ScreenSection
  // Passed by the section-renderer when the section's `enabledWhen` evaluates
  // to false. The form still renders — values stay visible — but every input
  // is inert, so the user sees what the data would be while knowing it cannot
  // change until the gate opens.
  disabled?: boolean
}

function FormLayout({ section, disabled = false }: FormLayoutProps) {
  const declared = (section.fields ?? []) as FieldDef[]
  const fields = declared.filter((field) => typeof field?.id === 'string' && SUPPORTED_FIELD_TYPES.has(field.type))

  const storage = useSectionStorage(section)
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const currentBoardInfo = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards.get(deviceBoard))

  const values: Record<string, string | number | boolean> = {}
  for (const field of fields) {
    if (field.type === UART_PIN_MAP_FIELD_TYPE) continue
    const storageKey = storageKeyFor(field)
    const stored = storage.values[storageKey] as string | number | boolean | undefined
    values[field.id] = stored ?? (field.default as string | number | boolean) ?? ''
  }

  const updateField = (id: string, value: string | number | boolean | Record<string, string>) => {
    if (storage.readonly || disabled) return
    const field = fields.find((f) => f.id === id)
    if (!field) return
    const next = typeof value === 'object' ? values : { ...values, [id]: value }
    const patch: Record<string, string | number | boolean | Record<string, string>> = { [storageKeyFor(field)]: value }
    for (const other of fields) {
      if (other.id === id || other.default === undefined || other.type === UART_PIN_MAP_FIELD_TYPE) continue
      const otherKey = storageKeyFor(other)
      if (storage.values[otherKey] !== undefined) continue
      if (!evalVisible(other.visible, next)) continue
      patch[otherKey] = other.default as string | number | boolean
    }
    storage.setPayload(patch)
  }

  useEffect(() => {
    if (storage.readonly) return
    const patch: Record<string, string | number | boolean> = {}
    for (const field of fields) {
      if (field.default === undefined || field.type === UART_PIN_MAP_FIELD_TYPE) continue
      const storageKey = storageKeyFor(field)
      if (storage.values[storageKey] !== undefined) continue
      if (!evalVisible(field.visible, values)) continue
      patch[storageKey] = field.default as string | number | boolean
    }
    if (Object.keys(patch).length > 0) {
      storage.setPayload(patch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceBoard, storage.readonly])

  return (
    <TooltipProvider>
      <div className='flex flex-col gap-3'>
        {fields.map((field) => {
          if (!evalVisible(field.visible, values)) return null
          const fieldDomId = `vendor-field-${section.id}-${field.id}`
          if (field.type === UART_PIN_MAP_FIELD_TYPE) {
            return (
              <UartPinMapField
                key={field.id}
                sectionId={section.id}
                field={field}
                storedValues={storage.values}
                storageKey={storageKeyFor(field)}
                disabled={disabled}
                inputClassName={TEXT_INPUT_CLASS}
                onCommit={(pins) => updateField(field.id, pins)}
              />
            )
          }
          return (
            <div key={field.id} className='flex items-center gap-4'>
              {field.type === 'boolean' ? (
                <>
                  <Label
                    htmlFor={fieldDomId}
                    className='min-w-32 shrink-0 whitespace-nowrap text-xs text-neutral-950 dark:text-white'
                  >
                    {field.label}
                  </Label>
                  <ToggleSwitch
                    id={fieldDomId}
                    checked={values[field.id] === true}
                    onCheckedChange={(checked) => updateField(field.id, checked)}
                    disabled={disabled}
                    aria-label={field.label}
                  />
                  {field.help && <FieldHelpIcon text={field.help} />}
                </>
              ) : (
                <>
                  <Label
                    htmlFor={fieldDomId}
                    className='min-w-32 shrink-0 whitespace-nowrap text-xs text-neutral-950 dark:text-white'
                  >
                    {field.label}
                  </Label>
                  {field.type === 'number' ? (
                    <div className='flex items-center gap-1'>
                      <input
                        id={fieldDomId}
                        type='number'
                        value={String(values[field.id] ?? '')}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        onChange={(e) => updateField(field.id, Number(e.target.value))}
                        disabled={disabled}
                        className='flex h-[30px] w-24 items-center rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                      />
                      {field.unit && (
                        <span className='text-xs text-neutral-500 dark:text-neutral-400'>{field.unit}</span>
                      )}
                    </div>
                  ) : field.type === 'select' ? (
                    <Select
                      value={String(values[field.id] ?? '')}
                      onValueChange={(v) => updateField(field.id, v)}
                      disabled={disabled}
                    >
                      <SelectTrigger
                        id={fieldDomId}
                        aria-label={field.label}
                        placeholder='Select...'
                        withIndicator
                        className='flex h-[30px] w-48 items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[disabled]:cursor-not-allowed data-[state=open]:border-brand-medium-dark data-[disabled]:opacity-50 dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                      />
                      <SelectContent
                        className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
                        sideOffset={5}
                        position='popper'
                        align='center'
                        side='bottom'
                      >
                        {resolveFieldOptions(field, { board: currentBoardInfo }).map((opt) => {
                          const value = typeof opt === 'string' ? opt : opt.value
                          const label = typeof opt === 'string' ? opt : opt.label
                          return (
                            <SelectItem
                              key={value}
                              value={value}
                              className='flex w-full cursor-pointer items-center px-2 py-[6px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850'
                            >
                              <span className='font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                                {label}
                              </span>
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  ) : field.type === 'password' ? (
                    <input
                      id={fieldDomId}
                      type='password'
                      value={String(values[field.id] ?? '')}
                      onChange={(e) => updateField(field.id, e.target.value)}
                      placeholder={field.placeholder}
                      maxLength={field.maxLength}
                      pattern={field.validation}
                      autoComplete='new-password'
                      disabled={disabled}
                      className={TEXT_INPUT_CLASS}
                    />
                  ) : field.type === 'ip-address' ? (
                    <input
                      id={fieldDomId}
                      type='text'
                      inputMode='decimal'
                      value={String(values[field.id] ?? '')}
                      onChange={(e) => updateField(field.id, e.target.value)}
                      placeholder={field.placeholder ?? '0.0.0.0'}
                      maxLength={field.maxLength ?? 15}
                      pattern={field.validation ?? IPV4_PATTERN}
                      disabled={disabled}
                      className={TEXT_INPUT_CLASS}
                    />
                  ) : field.type === 'mac-address' ? (
                    <input
                      id={fieldDomId}
                      type='text'
                      value={String(values[field.id] ?? '')}
                      onChange={(e) => updateField(field.id, e.target.value)}
                      placeholder={field.placeholder ?? 'AA:BB:CC:DD:EE:FF'}
                      maxLength={field.maxLength ?? 17}
                      pattern={field.validation ?? MAC_PATTERN}
                      disabled={disabled}
                      className={TEXT_INPUT_CLASS}
                    />
                  ) : (
                    <input
                      id={fieldDomId}
                      type='text'
                      value={String(values[field.id] ?? '')}
                      onChange={(e) => updateField(field.id, e.target.value)}
                      placeholder={field.placeholder}
                      maxLength={field.maxLength}
                      pattern={field.validation}
                      disabled={disabled}
                      className={TEXT_INPUT_CLASS}
                    />
                  )}
                  {field.help && <FieldHelpIcon text={field.help} />}
                </>
              )}
            </div>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

export { FormLayout }
