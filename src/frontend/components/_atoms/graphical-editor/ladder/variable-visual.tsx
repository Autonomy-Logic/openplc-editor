import {
  type LabelBox,
  LADDER_STYLE,
  LADDER_TYPOGRAPHY,
  textWidthPx,
} from '@root/middleware/shared/utils/ladder-layout'
import type { ReactNode } from 'react'

import { LadderLocationText, LadderText } from './ladder-text'
import { labelOfRole, useLadderNodeView } from './rung-view'

/** Which side of its block a pin variable sits on: `input` on the left, `output` on the right. */
export type PinVariableSide = 'input' | 'output'

/** The name label of a pin variable, or where it goes when the layout has none. */
function pinNameLabel(labels: readonly LabelBox[], side: PinVariableSide, width: number): LabelBox {
  return (
    labelOfRole(labels, 'pinVariable') ?? {
      text: '',
      x: side === 'input' ? width : 0,
      y: LADDER_STYLE.P / 2 + LADDER_TYPOGRAPHY.nameSizePx * 0.36,
      sizePx: LADDER_TYPOGRAPHY.nameSizePx,
      weight: 400,
      anchor: side === 'input' ? 'end' : 'start',
      role: 'pinVariable',
    }
  )
}

/** Props of the drawing of a block pin variable, shared by the editor and the diff view. */
export interface LadderPinVariableVisualProps {
  nodeId: string
  side: PinVariableSide
  variableName: string
  placeholder: string
  width: number
  fill?: string
  fontWeight?: number
  nameSlot?: (label: LabelBox) => ReactNode
  /** Drawn at the outer end of the name, on the pin wire, such as the debug value badge. */
  badge?: ReactNode
}

/** A block pin variable: its name on the pin wire and its location line below, from the rung layout. */
export function LadderPinVariableVisual({
  nodeId,
  side,
  variableName,
  placeholder,
  width,
  fill,
  fontWeight,
  nameSlot,
  badge,
}: LadderPinVariableVisualProps) {
  const { labels, palette, labelSource } = useLadderNodeView(nodeId)
  const nameLabel = pinNameLabel(labels, side, width)
  const locationLabel = labelOfRole(labels, 'location')
  const shownWidth = textWidthPx(variableName === '' ? placeholder : variableName, nameLabel.sizePx)
  const outerX = side === 'input' ? nameLabel.x - shownWidth : nameLabel.x + shownWidth

  return (
    <>
      {nameSlot ? (
        nameSlot(nameLabel)
      ) : (
        <LadderText
          label={nameLabel}
          text={variableName === '' ? placeholder : variableName}
          fill={variableName === '' ? palette.muted : (fill ?? palette.text)}
          fontWeight={fontWeight}
          hoverOnly={variableName === ''}
          testId={`ld-name-${nodeId}`}
        />
      )}
      {locationLabel && (
        <LadderLocationText
          label={locationLabel}
          variableName={variableName}
          labelSource={labelSource}
          fill={palette.loc}
          testId={`ld-location-${nodeId}`}
        />
      )}
      {badge !== undefined && (
        <div className='pointer-events-none absolute h-0 w-0' style={{ left: outerX, top: LADDER_STYLE.P / 2 }}>
          {badge}
        </div>
      )}
    </>
  )
}
