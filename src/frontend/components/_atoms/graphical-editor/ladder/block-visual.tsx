import { ReactNode } from 'react'

import { cn } from '../../../../utils/cn'
import { InOutPinMarker } from '../in-out-pin-marker'
import {
  DEFAULT_BLOCK_CONNECTOR_Y,
  DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
  DEFAULT_BLOCK_HEIGHT,
  DEFAULT_BLOCK_WIDTH,
} from './utils/constants'

export type BlockNodeVisualProps = {
  blockName: string
  inputConnectors: string[]
  outputConnectors: string[]
  /**
   * Names among `inputConnectors` that are `VAR_IN_OUT` parameters, so they get the ⟷ marker
   * here too. Read-only views receive plain name strings and cannot tell an in-out from a
   * regular input on their own — without this a diff would silently omit the marker and show a
   * block that looks different from the one in the editor.
   */
  inOutConnectors?: ReadonlySet<string>
  width?: number
  height?: number
  selected?: boolean
  wrongVariable?: boolean
  wrongName?: boolean
  disabled?: boolean
  scale?: number
  className?: string
  /** Optional slot to replace the default block name text (e.g. with an InputWithRef) */
  nameSlot?: ReactNode
}

export const BlockNodeVisual = ({
  blockName,
  inputConnectors,
  outputConnectors,
  inOutConnectors,
  width = DEFAULT_BLOCK_WIDTH,
  height = DEFAULT_BLOCK_HEIGHT,
  selected = false,
  wrongVariable = false,
  wrongName = false,
  disabled = false,
  scale = 1,
  className,
  nameSlot,
}: BlockNodeVisualProps) => {
  return (
    <div
      className={cn(
        'relative flex flex-col rounded-md border border-neutral-850 bg-white text-neutral-1000 dark:bg-neutral-900 dark:text-neutral-50',
        {
          'hover:border-transparent hover:ring-2 hover:ring-brand': !disabled,
          'border-transparent ring-1 ring-red-500': wrongVariable || wrongName,
          'border-transparent ring-2 ring-brand': selected,
        },
        className,
      )}
      style={{
        width,
        height,
        transform: `scale(${scale})`,
      }}
    >
      {nameSlot !== undefined ? (
        nameSlot
      ) : (
        <div className='absolute top-2 w-full truncate bg-transparent px-1 text-center text-xs'>{blockName}</div>
      )}
      {inputConnectors.map((connector, index) => (
        <div
          key={index}
          className='absolute text-xs'
          style={{ top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET - 10, left: 6 }}
        >
          {connector}
          {inOutConnectors?.has(connector) && <InOutPinMarker />}
        </div>
      ))}
      {outputConnectors.map((connector, index) => (
        <div
          key={index}
          className='absolute text-xs'
          style={{ top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET - 10, right: 6 }}
        >
          {connector}
        </div>
      ))}
    </div>
  )
}
