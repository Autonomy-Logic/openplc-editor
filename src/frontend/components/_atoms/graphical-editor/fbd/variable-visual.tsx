import { ReactNode } from 'react'

import { cn } from '../../../../utils/cn'
import { FbdSlimFrame } from './block-visual'
import { FBD_MONO_CLASS } from './utils/block-style'
import {
  DEFAULT_VARIABLE_HEIGHT,
  DEFAULT_VARIABLE_WIDTH,
  VARIABLE_ELEMENT_HEIGHT,
  VARIABLE_ELEMENT_SIZE,
} from './utils/constants'

export type VariableVisualProps = {
  variableName: string
  placeholder?: string
  selected?: boolean
  inputError?: boolean
  isAVariable?: boolean
  isForced?: boolean
  forcedValue?: boolean
  debuggerColor?: string
  className?: string
  /** Outer width of the box; defaults to the fixed legacy width */
  width?: number
  /** Native tooltip, e.g. the full name where the box truncates it */
  title?: string
  /** Optional slot to replace the default text (e.g. with a HighlightedTextArea) */
  nameSlot?: ReactNode
}

export const VariableVisual = ({
  variableName,
  placeholder,
  selected = false,
  inputError = false,
  isAVariable = true,
  isForced = false,
  forcedValue,
  debuggerColor,
  className,
  width = VARIABLE_ELEMENT_SIZE,
  title,
  nameSlot,
}: VariableVisualProps) => {
  return (
    <div
      title={title}
      style={{ width, height: VARIABLE_ELEMENT_HEIGHT }}
      className={cn(
        'group relative flex items-center justify-center p-1 text-neutral-1000 dark:text-neutral-50',
        className,
      )}
    >
      <FbdSlimFrame selected={selected && !debuggerColor} borderColour={debuggerColor} />
      <div
        className='relative flex items-center'
        style={{ width: width - (VARIABLE_ELEMENT_SIZE - DEFAULT_VARIABLE_WIDTH), height: DEFAULT_VARIABLE_HEIGHT }}
      >
        {nameSlot !== undefined ? (
          nameSlot
        ) : (
          <span
            className={cn('relative w-full truncate text-center text-xs leading-3', FBD_MONO_CLASS, {
              'text-yellow-500': !isAVariable,
              'text-red-500': inputError,
              'font-bold': isForced,
              'text-[#80C000]': isForced && forcedValue,
              'text-[#4080FF]': isForced && !forcedValue,
            })}
          >
            {variableName || placeholder || '...'}
          </span>
        )}
      </div>
    </div>
  )
}
