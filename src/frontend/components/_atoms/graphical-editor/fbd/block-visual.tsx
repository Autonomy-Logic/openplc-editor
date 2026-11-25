import { LADDER_STYLE } from '@root/middleware/shared/utils/ladder-layout'
import { type MouseEventHandler, ReactNode } from 'react'

import { cn } from '../../../../utils/cn'
import { InOutPinMarker } from '../in-out-pin-marker'
import { useLadderThemePalette } from '../ladder/rung-view'
import { FBD_BLOCK_TYPE_STYLE, FBD_PIN_STYLE, FBD_SLIM_INSET, useFbdPinColour } from './utils/block-style'
import {
  DEFAULT_BLOCK_CONNECTOR_Y,
  DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
  DEFAULT_BLOCK_HEIGHT,
  DEFAULT_BLOCK_WIDTH,
} from './utils/constants'

/** Stroke width of an FBD block border, as an LD block draws it. */
const BORDER_STROKE = 1.1

type FbdBlockFrameProps = {
  width: number
  height: number
  scale?: number
  selected?: boolean
  invalid?: boolean
  disabled?: boolean
  className?: string
  onMouseEnter?: MouseEventHandler<HTMLDivElement>
  onMouseLeave?: MouseEventHandler<HTMLDivElement>
  children: ReactNode
}

/** The box of an FBD block in the LD block style: thin border, header band, theme colours; the size is the node's. */
export const FbdBlockFrame = ({
  width,
  height,
  scale = 1,
  selected = false,
  invalid = false,
  disabled = false,
  className,
  onMouseEnter,
  onMouseLeave,
  children,
}: FbdBlockFrameProps) => {
  const palette = useLadderThemePalette()
  return (
    <div
      className={cn(
        'relative rounded-[2px]',
        {
          'hover:ring-2 hover:ring-brand': !disabled && !selected,
          'ring-1 ring-red-500': invalid && !selected,
          'ring-2 ring-brand': selected,
        },
        className,
      )}
      style={{ width, height, transform: `scale(${scale})`, color: palette.text }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <svg className='pointer-events-none absolute left-0 top-0' width={width} height={height} aria-hidden>
        <rect
          x={0.5}
          y={0.5}
          width={Math.max(0, width - 1)}
          height={Math.max(0, height - 1)}
          rx={2}
          fill={palette.blockFill}
          stroke={palette.wire}
          strokeWidth={BORDER_STROKE}
        />
        <rect x={1} y={1} width={Math.max(0, width - 2)} height={LADDER_STYLE.blkHead - 1} fill={palette.blockHeader} />
      </svg>
      {children}
    </div>
  )
}

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
  const pinColour = useFbdPinColour()
  return (
    <FbdBlockFrame
      width={width}
      height={height}
      scale={scale}
      selected={selected}
      invalid={wrongVariable || wrongName}
      disabled={disabled}
      className={className}
    >
      {nameSlot !== undefined ? (
        nameSlot
      ) : (
        <div className='absolute flex items-center truncate' style={FBD_BLOCK_TYPE_STYLE}>
          {blockName}
        </div>
      )}
      {inputConnectors.map((connector, index) => (
        <div
          key={index}
          className='absolute flex items-center'
          style={{
            ...FBD_PIN_STYLE,
            color: pinColour,
            top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET - 8,
            left: 6,
          }}
        >
          {connector}
          {inOutConnectors?.has(connector) && <InOutPinMarker />}
        </div>
      ))}
      {outputConnectors.map((connector, index) => (
        <div
          key={index}
          className='absolute'
          style={{
            ...FBD_PIN_STYLE,
            color: pinColour,
            top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET - 8,
            right: 6,
          }}
        >
          {connector}
        </div>
      ))}
    </FbdBlockFrame>
  )
}

/**
 * The slim shape of an FBD variable: a box inset from the top and bottom of its node, so the node and its handles keep
 * their size and place; thin border and theme colours as an LD block, the selection ring on the shape.
 */
export const FbdSlimFrame = ({ selected = false, borderColour }: { selected?: boolean; borderColour?: string }) => {
  const palette = useLadderThemePalette()
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-0 rounded-[2px] border group-hover:ring-2 group-hover:ring-brand',
        {
          'ring-2 ring-brand': selected,
        },
      )}
      style={{
        top: FBD_SLIM_INSET,
        bottom: FBD_SLIM_INSET,
        borderColor: borderColour ?? palette.wire,
        background: palette.blockFill,
      }}
    />
  )
}
