import { ReactNode } from 'react'

import { cn } from '../../../../utils/cn'
import { DEFAULT_COIL_BLOCK_HEIGHT, DEFAULT_COIL_BLOCK_WIDTH, DEFAULT_COIL_TYPES } from './utils/constants'

export type CoilVisualProps = {
  variant: string
  selected?: boolean
  wrongVariable?: boolean
  debuggerFillColor?: string
  className?: string
  /** Optional slot to replace the default variable name text (e.g. with a HighlightedTextArea) */
  nameSlot?: ReactNode
  /** Variable name displayed above the coil (used when nameSlot is not provided) */
  variableName?: string
}

export const CoilVisual = ({
  variant,
  selected = false,
  wrongVariable = false,
  debuggerFillColor,
  className,
  nameSlot,
  variableName,
}: CoilVisualProps) => {
  const coil = DEFAULT_COIL_TYPES[variant as keyof typeof DEFAULT_COIL_TYPES] ?? DEFAULT_COIL_TYPES.default

  return (
    <div
      className={cn(
        'relative rounded-[1px] border border-transparent hover:outline hover:outline-2 hover:outline-offset-[3px] hover:outline-brand',
        {
          'outline outline-2 outline-offset-[3px] outline-brand': selected,
        },
        className,
      )}
      style={{ width: DEFAULT_COIL_BLOCK_WIDTH, height: DEFAULT_COIL_BLOCK_HEIGHT }}
    >
      {coil.svg(wrongVariable, debuggerFillColor)}
      {nameSlot !== undefined
        ? nameSlot
        : variableName && (
            <div className='absolute -top-5 left-1/2 w-[72px] -translate-x-1/2'>
              <div className='truncate text-center text-xs leading-3 text-neutral-1000 dark:text-neutral-50'>
                {variableName}
              </div>
            </div>
          )}
    </div>
  )
}
