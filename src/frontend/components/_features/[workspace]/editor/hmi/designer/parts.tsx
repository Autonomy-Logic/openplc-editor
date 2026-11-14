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

const CONTROL_CLASS =
  'flex h-[26px] w-[26px] items-center justify-center rounded-[25%] border border-[#d0d0d0] bg-[#f5f5f5] hover:bg-[#e0e0e0] dark:border-neutral-900 dark:bg-neutral-900 dark:hover:bg-neutral-800'

const ControlIcon = ({ d, active = false }: { d: string; active?: boolean }) => (
  <svg
    width='14'
    height='14'
    viewBox='0 0 24 24'
    fill='none'
    strokeWidth='2.2'
    strokeLinecap='round'
    strokeLinejoin='round'
    className={active ? 'stroke-white' : 'stroke-neutral-900 dark:stroke-neutral-300'}
    aria-hidden='true'
  >
    <path d={d} />
  </svg>
)

const HAND =
  'M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-2a1.5 1.5 0 0 1 3 0V12M14 10.5a1.5 1.5 0 0 1 3 0V12M17 11.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 15a1.5 1.5 0 0 1 2.4-1.8L8 15'

/** The canvas's floating controls, as the FBD editor's: zoom in, zoom out, fit, and preview mode; then the zoom. */
export function CanvasControls(props: {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  preview: boolean
  onPreview: () => void
}) {
  return (
    <div className='absolute bottom-3 left-3 z-10 flex flex-col items-start gap-[3px]'>
      <button
        type='button'
        aria-label='Zoom in'
        title='Zoom in'
        data-testid='hmi-zoom-in'
        onClick={props.onZoomIn}
        className={CONTROL_CLASS}
      >
        <ControlIcon d='M12 5v14M5 12h14' />
      </button>
      <button
        type='button'
        aria-label='Zoom out'
        title='Zoom out'
        data-testid='hmi-zoom-out'
        onClick={props.onZoomOut}
        className={CONTROL_CLASS}
      >
        <ControlIcon d='M5 12h14' />
      </button>
      <button
        type='button'
        aria-label='Fit the screen'
        title='Fit the screen'
        data-testid='hmi-zoom-fit'
        onClick={props.onFit}
        className={CONTROL_CLASS}
      >
        <ControlIcon d='M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' />
      </button>
      <button
        type='button'
        aria-label='Preview mode'
        title='Preview mode: operate the screen'
        aria-pressed={props.preview}
        data-testid='hmi-preview-mode'
        onClick={props.onPreview}
        className={cn(CONTROL_CLASS, props.preview && '!border-brand-medium !bg-brand')}
      >
        <ControlIcon d={HAND} active={props.preview} />
      </button>
      <span
        className='mt-1 flex h-[22px] items-center rounded-[5px] border border-[#d0d0d0] bg-[#f5f5f5] px-1.5 font-caption text-[11px] font-semibold text-neutral-850 dark:border-neutral-900 dark:bg-neutral-900 dark:text-neutral-300'
        data-testid='hmi-zoom'
      >
        {Math.round(props.zoom * 100)}%
      </span>
    </div>
  )
}

/** The short notice at the top of the canvas while it is shown. */
export function PreviewNotice(props: { visible: boolean }) {
  return (
    <div
      role='status'
      aria-live='polite'
      data-testid='hmi-preview-notice'
      data-visible={props.visible}
      className={cn(
        'pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg bg-[rgba(1,30,75,0.9)] px-3.5 py-2 font-caption text-[13px] text-white shadow-lg transition-opacity duration-300',
        props.visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      Preview mode, press Esc to exit
    </div>
  )
}
