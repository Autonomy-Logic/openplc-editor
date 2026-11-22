import {
  EMPTY_LABEL_SOURCE,
  type LabelBox,
  LADDER_STYLE,
  LADDER_TYPOGRAPHY,
  type LadderPalette,
  layoutRung,
  textWidthPx,
} from '@root/middleware/shared/utils/ladder-layout'
import type { Node } from '@xyflow/react'
import type { ReactNode } from 'react'

import { cn } from '../../../../utils/cn'
import { IN_OUT_MARKER_PATH } from '../in-out-pin-marker'
import { LadderText, LadderTextLayer } from './ladder-text'
import { labelOfRole, relativeLabels } from './rung-view'

/** Stroke width of a block border, and of one drawn in the energized colour. */
const BORDER_STROKE = { normal: 1.1, on: 1.6 } as const

/** Gap between an in-out pin name and its marker, and the marker's size, in px. */
const MARKER = { gap: 4, width: 12, height: 9 } as const

/** Props of the drawing of a block, shared by the editor, the element dialog preview and the diff view. */
export interface LadderBlockVisualProps {
  nodeId: string
  width: number
  height: number
  labels: readonly LabelBox[]
  palette: LadderPalette
  typeName: string
  instanceName: string
  showInstance: boolean
  inOutPins: ReadonlySet<string>
  borderColour: string
  energized?: boolean
  selected?: boolean
  invalid?: boolean
  interactive?: boolean
  instanceColour?: string
  typeSlot?: (label: LabelBox) => ReactNode
  instanceSlot?: (label: LabelBox) => ReactNode
}

/** Where a block's instance name goes when the layout has no label for it: centred above the box. */
function instanceLabelOf(labels: readonly LabelBox[], width: number, text: string): LabelBox {
  return (
    labelOfRole(labels, 'instance') ?? {
      text,
      x: width / 2,
      y: -5,
      sizePx: LADDER_TYPOGRAPHY.nameSizePx,
      weight: 400,
      anchor: 'middle',
      role: 'instance',
    }
  )
}

/** Where a block's type goes when the layout has no label for it: in the header band. */
function typeLabelOf(labels: readonly LabelBox[], text: string): LabelBox {
  return (
    labelOfRole(labels, 'blockType') ?? {
      text,
      x: LADDER_STYLE.blkPad,
      y: LADDER_STYLE.blkHead / 2 + LADDER_TYPOGRAPHY.nameSizePx * 0.36,
      sizePx: LADDER_TYPOGRAPHY.nameSizePx,
      weight: 600,
      anchor: 'start',
      role: 'blockType',
    }
  )
}

/** A block: its box with a header band holding the type, its pin names in rows, and its instance name above. */
export function LadderBlockVisual({
  nodeId,
  width,
  height,
  labels,
  palette,
  typeName,
  instanceName,
  showInstance,
  inOutPins,
  borderColour,
  energized = false,
  selected = false,
  invalid = false,
  interactive = false,
  instanceColour,
  typeSlot,
  instanceSlot,
}: LadderBlockVisualProps) {
  const typeLabel = typeLabelOf(labels, typeName)
  const instanceLabel = instanceLabelOf(labels, width, instanceName)
  const pins = labels.filter((label) => label.role === 'pinFormal')

  return (
    <div
      className={cn('relative rounded-[2px]', {
        'hover:ring-2 hover:ring-brand': interactive && !selected,
        'ring-1 ring-red-500': invalid && !selected,
        'ring-2 ring-brand': selected,
      })}
      style={{ width, height }}
    >
      <LadderTextLayer>
        <rect
          x={0.5}
          y={0.5}
          width={Math.max(0, width - 1)}
          height={Math.max(0, height - 1)}
          rx={2}
          fill={palette.blockFill}
          stroke={borderColour}
          strokeWidth={energized ? BORDER_STROKE.on : BORDER_STROKE.normal}
        />
        <rect x={1} y={1} width={Math.max(0, width - 2)} height={LADDER_STYLE.blkHead - 1} fill={palette.blockHeader} />
        {pins.map((pin) =>
          pin.anchor === 'start' && inOutPins.has(pin.text) ? (
            <path
              key={`marker-${pin.text}`}
              d={IN_OUT_MARKER_PATH}
              transform={`translate(${pin.x + textWidthPx(pin.text, pin.sizePx) + MARKER.gap} ${pin.y - MARKER.height})`}
              stroke={palette.muted}
              strokeWidth={1.2}
              strokeLinecap='round'
              strokeLinejoin='round'
              fill='none'
            />
          ) : null,
        )}
      </LadderTextLayer>
      {pins.map((pin) => (
        <LadderText key={`${pin.anchor}-${pin.text}`} label={pin} fill={palette.muted} />
      ))}
      {typeSlot ? (
        typeSlot(typeLabel)
      ) : (
        <LadderText label={typeLabel} text={typeName} fill={palette.text} testId={`ld-block-type-${nodeId}`} />
      )}
      {showInstance &&
        (instanceSlot ? (
          instanceSlot(instanceLabel)
        ) : (
          <LadderText
            label={instanceLabel}
            text={instanceName}
            fill={instanceColour ?? palette.text}
            testId={`ld-block-instance-${nodeId}`}
          />
        ))}
    </div>
  )
}

/** A block node laid out on its own, as the element dialog previews it: its labels and box size from the engine. */
export function standaloneBlockLayout(block: Node): { labels: readonly LabelBox[]; width: number; height: number } {
  const input = block.data.inputConnector
  const targetHandle =
    typeof input === 'object' && input !== null && 'id' in input && typeof input.id === 'string' ? input.id : null
  const rail: Node = {
    id: 'left-rail-preview',
    type: 'powerRail',
    position: { x: 0, y: 0 },
    data: { variant: 'left', handles: [] },
  }
  const layout = layoutRung(
    {
      id: 'preview',
      comment: '',
      defaultBounds: [0, 0],
      reactFlowViewport: [0, 0],
      selectedNodes: [],
      nodes: [rail, block],
      edges: [{ id: 'preview-edge', source: rail.id, target: block.id, sourceHandle: 'preview', targetHandle }],
    },
    EMPTY_LABEL_SOURCE,
  )
  const geometry = layout.nodes.get(block.id)
  return {
    labels: relativeLabels(layout.labels.get(block.id) ?? [], geometry),
    width: geometry?.width ?? block.width ?? 0,
    height: geometry?.height ?? block.height ?? 0,
  }
}
