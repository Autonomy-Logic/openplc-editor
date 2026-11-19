/** Small building blocks of the HMI designer, in the editor's own styles. */
import { HMI_BUILD_STEPS, type HmiBuildStep } from '@root/middleware/shared/ports/hmi-preview-types'
import { Background, ControlButton, ReactFlowProvider } from '@xyflow/react'
import { type ReactNode, useEffect, useState } from 'react'

import { cn } from '../../../../../../utils/cn'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../../../../_atoms/select'
import { PREVIEW_PROGRESS_DELAY_MS } from './preview-progress'

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

/** The FBD editor's frame of a canvas area: its border in both themes. */
export const CANVAS_AREA_CLASS = 'rounded-lg border dark:border-neutral-800'

/** A flow scope as the flow library's own wrapper sets it: filling its box and stacking its background behind it. */
const FLOW_SCOPE = 'react-flow relative z-0 h-full w-full overflow-hidden'

/** The FBD editor's dotted background, the flow library's own component in a flow scope, behind a canvas area. */
export function CanvasBackdrop(props: { id: string }) {
  return (
    <div className='pointer-events-none absolute inset-0' aria-hidden='true'>
      <div className={FLOW_SCOPE}>
        <ReactFlowProvider>
          <Background id={props.id} />
        </ReactFlowProvider>
      </div>
    </div>
  )
}

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
    <div className='pointer-events-none absolute inset-0 z-10'>
      <div className={FLOW_SCOPE}>
        <div className='react-flow__panel react-flow__controls bottom left pointer-events-auto'>
          <ControlButton aria-label='Zoom in' title='Zoom in' data-testid='hmi-zoom-in' onClick={props.onZoomIn}>
            <ControlIcon d='M12 5v14M5 12h14' />
          </ControlButton>
          <ControlButton aria-label='Zoom out' title='Zoom out' data-testid='hmi-zoom-out' onClick={props.onZoomOut}>
            <ControlIcon d='M5 12h14' />
          </ControlButton>
          <ControlButton
            aria-label='Fit the screen'
            title='Fit the screen'
            data-testid='hmi-zoom-fit'
            onClick={props.onFit}
          >
            <ControlIcon d='M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' />
          </ControlButton>
          <ControlButton
            aria-label='Preview mode'
            title='Preview mode: operate the screen'
            aria-pressed={props.preview}
            data-testid='hmi-preview-mode'
            onClick={props.onPreview}
            className={cn(props.preview && '!bg-brand')}
          >
            <ControlIcon d={HAND} active={props.preview} />
          </ControlButton>
          <span
            className='react-flow__controls-button !w-auto px-1.5 font-caption text-[11px] font-semibold text-neutral-850 dark:text-neutral-300'
            data-testid='hmi-zoom'
          >
            {Math.round(props.zoom * 100)}%
          </span>
        </div>
      </div>
    </div>
  )
}

/** A short notice at the top of the canvas, faded in while visible. */
function CanvasNotice(props: { visible: boolean; text: string; testId: string }) {
  return (
    <div
      role='status'
      aria-live='polite'
      data-testid={props.testId}
      data-visible={props.visible}
      className={cn(
        'pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg bg-[rgba(1,30,75,0.9)] px-3.5 py-2 font-caption text-[13px] text-white shadow-lg transition-opacity duration-300',
        props.visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      {props.text}
    </div>
  )
}

/** The notice of preview mode while it is shown. */
export function PreviewNotice(props: { visible: boolean }) {
  return <CanvasNotice visible={props.visible} text='Preview mode, press Esc to exit' testId='hmi-preview-notice' />
}

/** Why the last placement was refused, while shown. */
export function PlacementNotice(props: { visible: boolean; text: string }) {
  return <CanvasNotice visible={props.visible} text={props.text} testId='hmi-placement-notice' />
}

const STEP_LABELS: Record<HmiBuildStep, string> = {
  sources: 'Loading the HMI library',
  generate: 'Generating the screens',
  compile: 'Compiling the screens',
  start: 'Starting the preview',
}

/**
 * The build's step and how far along it is, in place of a screen until its first build, or over the last frame
 * dimmed, taking the canvas's input, once an edit has waited PREVIEW_PROGRESS_DELAY_MS for its build.
 */
export function PreviewLoading(props: { step: HmiBuildStep | null; dimmed?: boolean }) {
  const step = props.step ?? 'sources'
  const done = (HMI_BUILD_STEPS.indexOf(step) + 1) / HMI_BUILD_STEPS.length
  const [shown, setShown] = useState(!props.dimmed)
  useEffect(() => {
    if (!props.dimmed) return
    const timer = setTimeout(() => setShown(true), PREVIEW_PROGRESS_DELAY_MS)
    return () => clearTimeout(timer)
  }, [props.dimmed])
  if (!shown) return null
  return (
    <div
      role='status'
      aria-live='polite'
      data-testid='hmi-preview-loading'
      data-step={step}
      data-dimmed={props.dimmed ? 'true' : 'false'}
      className={cn(
        'absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg',
        props.dimmed ? 'bg-[#F7F8FA]/70 dark:bg-neutral-950/70' : 'bg-[#F7F8FA] dark:bg-neutral-950',
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <p className='font-caption text-sm font-semibold text-neutral-850 dark:text-neutral-200'>Building the preview</p>
      <div className='h-1.5 w-56 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800'>
        <div
          className='h-full rounded-full bg-brand transition-[width] duration-500'
          style={{ width: `${done * 100}%` }}
        />
      </div>
      <p className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>{STEP_LABELS[step]}</p>
    </div>
  )
}
