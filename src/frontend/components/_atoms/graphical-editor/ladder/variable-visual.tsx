import { ReactNode } from 'react'

import { cn } from '../../../../utils/cn'
import { DEFAULT_VARIABLE_HEIGHT, DEFAULT_VARIABLE_WIDTH } from './utils/constants'

export type VariableVisualProps = {
  variableName: string
  /** Placeholder text shown when variable name is empty, e.g. "(*STRING*)" */
  placeholder?: string
  /** 'input' or 'output' -- controls text alignment */
  variant?: string
  inputError?: boolean
  isAVariable?: boolean
  isForced?: boolean
  forcedValue?: boolean
  className?: string
  /** Optional slot to replace the default text (e.g. with a HighlightedTextArea) */
  nameSlot?: ReactNode
}

export const VariableVisual = ({
  variableName,
  placeholder = '',
  variant,
  inputError = false,
  isAVariable = true,
  isForced = false,
  forcedValue,
  className,
  nameSlot,
}: VariableVisualProps) => {
  return (
    <div style={{ width: DEFAULT_VARIABLE_WIDTH, height: DEFAULT_VARIABLE_HEIGHT }} className={className}>
      {nameSlot !== undefined ? (
        nameSlot
      ) : (
        <div
          className={cn('flex h-full w-full items-center text-xs leading-3', {
            'text-left': variant === 'output',
            'text-right': variant === 'input',
            'text-center': !variant || (variant !== 'input' && variant !== 'output'),
            'text-yellow-500': !isAVariable,
            'text-red-500': inputError,
            'font-bold': isForced,
            'text-[#80C000]': isForced && forcedValue,
            'text-[#4080FF]': isForced && !forcedValue,
            'text-neutral-1000 dark:text-neutral-50': isAVariable && !inputError && !isForced,
            'text-neutral-500 dark:text-neutral-400': !variableName,
          })}
        >
          <span className='w-full truncate'>{variableName || placeholder}</span>
        </div>
      )}
    </div>
  )
}
