/**
 * Paper size, orientation, margins, and render mode — shared between the
 * standalone Page Setup modal and the export-to-PDF wizard's options step.
 * Reads/writes `print.pageSetup`/`renderMode` directly via `printActions`,
 * so it takes no props and can be dropped in either place unchanged.
 */

import type { ChangeEvent } from 'react'

import { useOpenPLCStore } from '../../../store'
import type { Orientation, PageMargins, PaperSize, PrintRenderMode } from '../../../store/slices/print'

const PAPER_SIZES: { value: PaperSize; label: string }[] = [
  { value: 'a4', label: 'A4' },
  { value: 'a3', label: 'A3' },
  { value: 'letter', label: 'Letter' },
  { value: 'legal', label: 'Legal' },
]

const MARGIN_SIDES: (keyof PageMargins)[] = ['top', 'right', 'bottom', 'left']

const LABEL = 'text-sm font-medium text-neutral-850 dark:text-neutral-300'
const RADIO_LABEL = 'flex items-center gap-2 text-sm text-neutral-850 dark:text-neutral-300'
const FIELD_INPUT =
  'rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100'

const PageSetupFields = () => {
  const { print, printActions } = useOpenPLCStore()
  const { pageSetup, renderMode } = print

  const handleMarginChange = (side: keyof PageMargins) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value)
    if (Number.isNaN(value) || value < 0) return
    printActions.setPageSetup({ margins: { ...pageSetup.margins, [side]: value } })
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-1'>
        <label htmlFor='print-paper-size' className={LABEL}>
          Paper size
        </label>
        <select
          id='print-paper-size'
          value={pageSetup.size}
          onChange={(event) => printActions.setPageSetup({ size: event.target.value as PaperSize })}
          className={FIELD_INPUT}
        >
          {PAPER_SIZES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className='flex flex-col gap-1'>
        <legend className={LABEL}>Orientation</legend>
        <div className='flex gap-4'>
          {(['portrait', 'landscape'] as Orientation[]).map((orientation) => (
            <label key={orientation} className={RADIO_LABEL}>
              <input
                type='radio'
                name='print-orientation'
                checked={pageSetup.orientation === orientation}
                onChange={() => printActions.setPageSetup({ orientation })}
              />
              {orientation === 'portrait' ? 'Portrait' : 'Landscape'}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className='flex flex-col gap-1'>
        <legend className={LABEL}>Margins (pt)</legend>
        <div className='grid grid-cols-2 gap-2'>
          {MARGIN_SIDES.map((side) => (
            <label
              key={side}
              className='flex items-center justify-between gap-2 text-sm capitalize text-neutral-850 dark:text-neutral-300'
            >
              {side}
              <input
                type='number'
                min={0}
                value={pageSetup.margins[side]}
                onChange={handleMarginChange(side)}
                className={`w-20 ${FIELD_INPUT}`}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className='flex flex-col gap-1'>
        <legend className={LABEL}>Render mode</legend>
        <div className='flex gap-4'>
          <label className={RADIO_LABEL}>
            <input
              type='radio'
              name='print-render-mode'
              checked={renderMode === 'normal'}
              onChange={() => printActions.setRenderMode('normal' satisfies PrintRenderMode)}
            />
            Normal
          </label>
          <label className={RADIO_LABEL}>
            <input
              type='radio'
              name='print-render-mode'
              checked={renderMode === 'scale-to-fit'}
              onChange={() => printActions.setRenderMode('scale-to-fit' satisfies PrintRenderMode)}
            />
            Scale to fit
          </label>
        </div>
      </fieldset>
    </div>
  )
}

export { PageSetupFields }
