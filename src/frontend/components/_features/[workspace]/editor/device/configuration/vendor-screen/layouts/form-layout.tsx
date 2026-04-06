import { Checkbox } from '@root/frontend/components/_atoms/checkbox'
import { Label } from '@root/frontend/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/frontend/components/_atoms/select'
import { useOpenPLCStore } from '@root/frontend/store'

import type { ScreenSection } from '../index'

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
}

type FormLayoutProps = {
  section: ScreenSection
}

function FormLayout({ section }: FormLayoutProps) {
  const fields = (section.fields ?? []) as FieldDef[]

  const vendorScreenData = useOpenPLCStore((s) => s.deviceDefinitions.configuration.vendorScreenData)
  const setVendorScreenData = useOpenPLCStore((s) => s.deviceActions.setVendorScreenData)
  const persistenceKey = section.persistence || section.id

  const storedValues = vendorScreenData?.[persistenceKey] as Record<string, string | number | boolean> | undefined
  const values: Record<string, string | number | boolean> = {}
  for (const field of fields) {
    values[field.id] = storedValues?.[field.id] ?? (field.default as string | number | boolean) ?? ''
  }

  const updateField = (id: string, value: string | number | boolean) => {
    setVendorScreenData(persistenceKey, { ...storedValues, [id]: value })
  }

  return (
    <div className='flex flex-col gap-3'>
      {fields.map((field) => (
        <div key={field.id} className='flex flex-col gap-1'>
          <div className='flex items-center gap-2'>
            {field.type === 'boolean' ? (
              <>
                <Checkbox
                  id={`vendor-field-${field.id}`}
                  checked={values[field.id] === true}
                  onCheckedChange={(checked) => updateField(field.id, checked as boolean)}
                  className={
                    values[field.id] === true
                      ? 'h-[14px] w-[14px] border-brand'
                      : 'h-[14px] w-[14px] border-neutral-300'
                  }
                />
                <Label htmlFor={`vendor-field-${field.id}`} className='text-xs text-neutral-950 dark:text-white'>
                  {field.label}
                </Label>
              </>
            ) : (
              <>
                <Label className='w-32 shrink-0 text-xs text-neutral-950 dark:text-white'>{field.label}</Label>
                {field.type === 'number' ? (
                  <div className='flex items-center gap-1'>
                    <input
                      type='number'
                      value={String(values[field.id] ?? '')}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      onChange={(e) => updateField(field.id, Number(e.target.value))}
                      className='flex h-[30px] w-24 items-center rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                    />
                    {field.unit && <span className='text-xs text-neutral-500 dark:text-neutral-400'>{field.unit}</span>}
                  </div>
                ) : field.type === 'select' ? (
                  <Select value={String(values[field.id] ?? '')} onValueChange={(v) => updateField(field.id, v)}>
                    <SelectTrigger
                      aria-label={field.label}
                      placeholder='Select...'
                      withIndicator
                      className='flex h-[30px] w-48 items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                    />
                    <SelectContent
                      className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
                      sideOffset={5}
                      position='popper'
                      align='center'
                      side='bottom'
                    >
                      {(field.options ?? []).map((opt) => {
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
                ) : (
                  <input
                    type='text'
                    value={String(values[field.id] ?? '')}
                    onChange={(e) => updateField(field.id, e.target.value)}
                    className='flex h-[30px] w-48 items-center rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                  />
                )}
              </>
            )}
          </div>
          {field.help && <span className='ml-32 text-[11px] text-neutral-400 dark:text-neutral-500'>{field.help}</span>}
        </div>
      ))}
    </div>
  )
}

export { FormLayout }
