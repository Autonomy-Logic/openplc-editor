/** Small building blocks of the HMI designer, in the editor's own styles. */
import type { ReactNode } from 'react'

import { cn } from '../../../../../../utils/cn'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../../../../_atoms/select'

export const FIELD_CLASS =
  'h-[28px] w-full rounded-md border border-neutral-300 bg-white px-2 font-caption text-xs text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

export interface Option {
  value: string
  label: string
}

export function DesignerSelect(props: {
  value: string
  options: readonly Option[]
  onChange: (value: string) => void
  placeholder?: string
  testId?: string
  className?: string
}) {
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger
        withIndicator
        placeholder={props.placeholder}
        data-testid={props.testId}
        className={cn(
          'flex h-[28px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 font-caption !text-xs text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300',
          props.className,
        )}
      />
      <SelectContent className='z-[100] h-fit max-h-[240px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
        {props.options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className='flex w-full cursor-pointer items-center px-2 py-1 outline-none hover:bg-neutral-100 data-[state=checked]:bg-neutral-100 dark:hover:bg-neutral-800 dark:data-[state=checked]:bg-neutral-900'
          >
            <span className='font-caption text-xs text-neutral-700 dark:text-neutral-100'>{option.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function Section(props: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section
      className='flex flex-col gap-2 border-b border-neutral-200 px-3 py-3 dark:border-neutral-850'
      data-testid={props.testId}
    >
      <h3 className='font-caption text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
        {props.title}
      </h3>
      {props.children}
    </section>
  )
}

export function Field(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className='flex flex-col gap-1'>
      <span className='font-caption text-xs text-neutral-700 dark:text-neutral-300' title={props.hint}>
        {props.label}
      </span>
      {props.children}
    </label>
  )
}

export function ToolButton(props: {
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  testId?: string
  children: ReactNode
}) {
  return (
    <button
      type='button'
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      data-testid={props.testId}
      onClick={props.onClick}
      className={cn(
        'flex h-7 min-w-7 items-center justify-center rounded-md px-2 font-caption text-xs text-neutral-850 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-900',
        props.active && 'bg-brand text-white hover:bg-brand dark:bg-brand dark:text-white',
      )}
    >
      {props.children}
    </button>
  )
}
