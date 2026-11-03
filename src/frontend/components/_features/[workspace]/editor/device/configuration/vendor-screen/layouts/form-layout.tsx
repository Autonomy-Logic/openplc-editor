import { Label } from '@root/frontend/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/frontend/components/_atoms/select'
import { ToggleSwitch } from '@root/frontend/components/_atoms/toggle-switch'
import { FieldHelpIcon, TooltipProvider } from '@root/frontend/components/_atoms/tooltip'
import { useOpenPLCStore } from '@root/frontend/store'
import { evalVisible, type VisibleCondition } from '@root/frontend/utils/vpp/eval-visible'
import { resolveFieldOptions } from '@root/frontend/utils/vpp/field-options'
import { useEffect } from 'react'

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
  // Optional storage-key override. Field DOM / schema id is kebab-case
  // (`client-name`); the persistence payload may need a different key
  // (`clientName`). Writers use `persistAs ?? id`; the local values map
  // the visible-condition DSL reads from stays keyed by `id`, so
  // `fields.<id>` references survive the mapping.
  persistAs?: string
  // Optional conditional-visibility clause (VPP screen schema). Fields
  // without it always render; see `evalVisible`.
  visible?: VisibleCondition
}

function storageKeyFor(field: FieldDef): string {
  return field.persistAs && field.persistAs.length > 0 ? field.persistAs : field.id
}

// Shared input styling for every <input> branch (text, number, password,
// ip-address, mac-address). Keeping it in one place avoids style drift
// when new field types land. `disabled:` classes mirror the ToggleSwitch
// and Checkbox atoms so a section-level gate dims the whole form evenly.
const TEXT_INPUT_CLASS =
  'flex h-[30px] w-48 items-center rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

/**
 * The field types this layout knows how to render. A vendor package is
 * untrusted input, so dispatch is an allowlist: a field whose type is not here
 * renders NOTHING and never enters the value map, so it cannot be persisted
 * into `vendorScreenData` or reach the generated plugin config. The previous
 * behaviour — falling back to a text input — meant an unrecognised type still
 * produced a value the device would be configured with.
 */
const SUPPORTED_FIELD_TYPES = new Set(['boolean', 'number', 'select', 'password', 'ip-address', 'mac-address', 'text'])

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

  // Routes to the right project slice (vendorScreenData or vppExtensions) and
  // handles the read-modify-write merge; see `use-section-storage.ts`.
  const storage = useSectionStorage(section)
  // Board context for dynamic `optionsRef` resolution (e.g. the Modbus RTU
  // serial-port picker reading `board.serialPorts`).
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const currentBoardInfo = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards.get(deviceBoard))

  // The local values map is keyed by `field.id` so visible-condition
  // references stay stable regardless of how the field persists on disk.
  // Reads route through `persistAs ?? id`.
  const values: Record<string, string | number | boolean> = {}
  for (const field of fields) {
    const storageKey = storageKeyFor(field)
    const stored = storage.values[storageKey] as string | number | boolean | undefined
    values[field.id] = stored ?? (field.default as string | number | boolean) ?? ''
  }

  const updateField = (id: string, value: string | number | boolean) => {
    if (storage.readonly || disabled) return
    const field = fields.find((f) => f.id === id)
    if (!field) return
    // A `default` the user can see has to be a `default` the build gets.
    // Above, defaults fill `values` for rendering, but only what someone
    // actually typed was ever stored -- so a project that switched the
    // network on without opening the Interface dropdown compiled with no
    // carrier at all, and a Pico showing "17" for its chip select compiled
    // against the library's pin 10. Seed every default that is visible after
    // this edit and has nothing stored yet. Scoped to an edit the user is
    // already making in this section, so nothing is written behind their
    // back, and evaluated against the post-edit values so flipping a
    // section's switch on seeds the fields it reveals.
    const next = { ...values, [id]: value }
    const patch: Record<string, string | number | boolean> = { [storageKeyFor(field)]: value }
    for (const other of fields) {
      if (other.id === id || other.default === undefined) continue
      const otherKey = storageKeyFor(other)
      if (storage.values[otherKey] !== undefined) continue
      if (!evalVisible(other.visible, next)) continue
      patch[otherKey] = other.default as string | number | boolean
    }
    storage.setPayload(patch)
  }

  // Persist visible defaults when the screen is SHOWN, not only when the user
  // edits it. `updateField` seeds defaults on an edit, but a user who opens a
  // screen, agrees with every default and changes nothing left those defaults
  // unstored — so the build fell back to the library value (a Pico showing
  // "17" for chip select compiled against pin 10). Per-board storage already
  // keeps each target's data in its own bucket, so this writes into the active
  // board's bucket only. Runs on mount and whenever the section or board
  // changes; writes nothing when there is nothing new to seed, so it does not
  // dirty a project just by being viewed once everything is already stored.
  useEffect(() => {
    if (storage.readonly) return
    const patch: Record<string, string | number | boolean> = {}
    for (const field of fields) {
      if (field.default === undefined) continue
      const storageKey = storageKeyFor(field)
      if (storage.values[storageKey] !== undefined) continue
      if (!evalVisible(field.visible, values)) continue
      patch[storageKey] = field.default as string | number | boolean
    }
    if (Object.keys(patch).length > 0) {
      storage.setPayload(patch)
    }
    // `values`/storage are derived every render; depending on them directly
    // would loop. The board key stands in for "the active bucket changed".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceBoard, storage.readonly])

  return (
    <TooltipProvider>
      <div className='flex flex-col gap-3'>
        {fields.map((field) => {
          // Honor the field's conditional-visibility clause. Fields with
          // no `visible` clause always render.
          if (!evalVisible(field.visible, values)) return null
          // DOM id must be unique across the whole screen — sections can
          // reuse a field id (e.g. both modbus_rtu and modbus_tcp own an
          // `enabled` field). Scope by section.id so a label's `htmlFor`
          // can't target a same-named control in another section.
          const fieldDomId = `vendor-field-${section.id}-${field.id}`
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
                    // `text` — the only remaining allowlisted type.
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
