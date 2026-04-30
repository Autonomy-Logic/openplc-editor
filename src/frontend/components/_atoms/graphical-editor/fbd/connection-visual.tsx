import { ReactNode } from 'react'

import { cn } from '../../../../utils/cn'
import { ConnectorSVGComponent } from './svg/connector-svg'
import { ContinuationSVGComponent } from './svg/continuation-svg'
import {
  CONNECTION_ELEMENT_HEIGHT,
  CONNECTION_ELEMENT_WIDTH,
  DEFAULT_CONNECTION_HEIGHT,
  DEFAULT_CONNECTION_WIDTH,
} from './utils/constants'

export type ConnectionVisualProps = {
  variant: 'connector' | 'continuation'
  name: string
  selected?: boolean
  inputError?: boolean
  className?: string
  /** Optional slot to replace the default name text (e.g. with a HighlightedTextArea) */
  nameSlot?: ReactNode
}

export const ConnectionVisual = ({
  variant,
  name,
  selected = false,
  inputError = false,
  className,
  nameSlot,
}: ConnectionVisualProps) => {
  const SVGComponent = variant === 'continuation' ? ContinuationSVGComponent : ConnectorSVGComponent

  const renderContent = () => (
    <foreignObject width='100%' height='100%' x='0' y='0' className='relative'>
      <div
        style={{ width: DEFAULT_CONNECTION_WIDTH }}
        className={cn('absolute flex h-full items-center justify-center p-0.5', {
          'right-1': variant === 'connector',
          'left-1': variant === 'continuation',
        })}
      >
        <div style={{ height: DEFAULT_CONNECTION_HEIGHT }} className='flex w-full flex-row items-center'>
          {nameSlot !== undefined ? (
            nameSlot
          ) : (
            <span
              className={cn('w-full truncate text-center text-xs leading-3', {
                'text-red-500': inputError,
              })}
            >
              {name || '...'}
            </span>
          )}
        </div>
      </div>
    </foreignObject>
  )

  return (
    <SVGComponent
      style={{ width: CONNECTION_ELEMENT_WIDTH, height: CONNECTION_ELEMENT_HEIGHT }}
      className={cn(
        'fill-white stroke-neutral-850 stroke-1 text-neutral-1000 dark:fill-neutral-900 dark:text-neutral-50',
        'hover:stroke-brand hover:stroke-2',
        {
          'stroke-brand stroke-2': selected,
        },
        className,
      )}
    >
      {renderContent()}
    </SVGComponent>
  )
}
