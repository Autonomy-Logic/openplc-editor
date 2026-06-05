import { ReactNode } from 'react'

import { cn } from '../../../../utils/cn'
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
  nameSlot,
}: VariableVisualProps) => {
  return (
    <div
      style={{
        width: VARIABLE_ELEMENT_SIZE,
        height: VARIABLE_ELEMENT_HEIGHT,
        ...(debuggerColor
          ? {
              borderColor: debuggerColor,
              boxShadow: `0 0 0 2px ${debuggerColor}33 inset`,
            }
          : {}),
      }}
      className={cn(
        'relative flex items-center justify-center rounded-md border border-neutral-850 bg-white p-1 text-neutral-1000 dark:bg-neutral-900 dark:text-neutral-50',
        'hover:border-transparent hover:ring-2 hover:ring-brand',
        {
          'border-transparent ring-2 ring-brand': selected && !debuggerColor,
        },
        className,
      )}
    >
      <div
        className='relative flex items-center'
        style={{ width: DEFAULT_VARIABLE_WIDTH, height: DEFAULT_VARIABLE_HEIGHT }}
      >
        {nameSlot !== undefined ? (
          nameSlot
        ) : (
          <span
            className={cn('w-full truncate text-center text-xs leading-3', {
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
