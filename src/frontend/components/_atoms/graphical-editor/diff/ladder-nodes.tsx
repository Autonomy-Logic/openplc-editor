import { symbolKindOf } from '@root/middleware/shared/utils/ladder-layout'
import { Handle, type NodeProps, Position } from '@xyflow/react'

import type { DiffStatus } from '../../../../../middleware/shared/ports/version-control-port'
import { PlaceholderNodeFilled } from '../../../../assets/icons/flow/Placeholder'
import { inOutVariableNames } from '../../../../utils/graphical/in-out-pin-rules'
import { LadderBlockVisual } from '../ladder/block-visual'
import { ladderHandleStyle } from '../ladder/handle'
import { LadderCellVisual } from '../ladder/ladder-cell'
import { ladderSymbolInset } from '../ladder/ladder-symbol'
import { useLadderNodeView } from '../ladder/rung-view'
import { DEFAULT_PLACEHOLDER_HEIGHT, DEFAULT_PLACEHOLDER_WIDTH } from '../ladder/utils/constants'
import { LadderPinVariableVisual } from '../ladder/variable-visual'
import { DiffWrapper, renderHandles } from './diff-wrapper'

const POSITIONS: Readonly<Record<string, Position>> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const DIFF_STATUSES: readonly DiffStatus[] = ['added', 'removed', 'modified', 'unchanged']

/** The diff status the viewer stored on a node, or `unchanged`. */
function diffStatusOf(data: Record<string, unknown>): DiffStatus {
  return DIFF_STATUSES.find((status) => status === data.diffStatus) ?? 'unchanged'
}

/** The `name` of a node's variable, or empty. */
function variableNameOf(data: Record<string, unknown>): string {
  const variable = data.variable
  return isRecord(variable) && typeof variable.name === 'string' ? variable.name : ''
}

/** A node's stored handles drawn as hidden points on their relative positions; a symbol's handles `inset` inside it. */
function renderLadderHandles(handles: unknown, inset = 0) {
  if (!Array.isArray(handles)) return null
  return handles.map((handle: unknown, index) => {
    if (!isRecord(handle)) return null
    const type = handle.type === 'source' || handle.type === 'target' ? handle.type : undefined
    const position = typeof handle.position === 'string' ? POSITIONS[handle.position] : undefined
    if (type === undefined || position === undefined) return null
    return (
      <Handle
        key={index}
        id={typeof handle.id === 'string' ? handle.id : undefined}
        type={type}
        position={position}
        style={ladderHandleStyle({ relPosition: handle.relPosition }, type === 'target' ? inset : -inset)}
        className='opacity-0'
        isConnectable={false}
      />
    )
  })
}

export function ReadOnlyPowerRail({ id, data, height }: NodeProps) {
  const status = diffStatusOf(data)
  const { palette, geometry } = useLadderNodeView(id)
  const railHeight = geometry?.height ?? height ?? 0
  return (
    <DiffWrapper status={status}>
      <svg width={1} height={railHeight} style={{ display: 'block', overflow: 'visible' }}>
        <line x1={0} y1={0} x2={0} y2={railHeight} stroke={palette.rail} strokeWidth={2.5} />
      </svg>
      {renderLadderHandles(data.handles)}
    </DiffWrapper>
  )
}

/** A read-only contact or coil of the diff view, drawn as the editor draws it. */
function ReadOnlyCell({ id, data, type }: NodeProps) {
  const status = diffStatusOf(data)
  const { palette } = useLadderNodeView(id)
  const variant = typeof data.variant === 'string' ? data.variant : undefined
  const kind = symbolKindOf(type, variant) ?? 'contact'
  return (
    <DiffWrapper status={status}>
      <LadderCellVisual nodeId={id} kind={kind} variableName={variableNameOf(data)} symbolColour={palette.text} />
      {renderLadderHandles(data.handles, ladderSymbolInset(kind))}
    </DiffWrapper>
  )
}

export function ReadOnlyContact(props: NodeProps) {
  return <ReadOnlyCell {...props} />
}

export function ReadOnlyCoil(props: NodeProps) {
  return <ReadOnlyCell {...props} />
}

export function ReadOnlyBlock({ id, data, width, height }: NodeProps) {
  const status = diffStatusOf(data)
  const { labels, palette } = useLadderNodeView(id)
  const variant = isRecord(data.variant) ? data.variant : {}
  const blockType = typeof variant.type === 'string' ? variant.type : ''
  const typeName = typeof variant.name === 'string' ? variant.name : '???'
  const variables = Array.isArray(variant.variables)
    ? variant.variables.flatMap((entry: unknown) =>
        isRecord(entry) && typeof entry.name === 'string' && typeof entry.class === 'string'
          ? [{ name: entry.name, class: entry.class }]
          : [],
      )
    : []

  return (
    <DiffWrapper status={status}>
      <LadderBlockVisual
        nodeId={id}
        width={width ?? 0}
        height={height ?? 0}
        labels={labels}
        palette={palette}
        typeName={typeName}
        instanceName={variableNameOf(data)}
        showInstance={blockType !== 'function' && blockType !== 'generic'}
        inOutPins={inOutVariableNames(variables)}
        borderColour={palette.wire}
      />
      {renderLadderHandles(data.handles)}
    </DiffWrapper>
  )
}

export function ReadOnlyVariable({ id, data, width }: NodeProps) {
  const status = diffStatusOf(data)
  const owner = isRecord(data.block) ? data.block : {}
  const pinType = isRecord(owner.variableType) && isRecord(owner.variableType.type) ? owner.variableType.type.value : ''
  const placeholder = typeof pinType === 'string' && pinType !== '' ? `(*${pinType}*)` : ''

  return (
    <DiffWrapper status={status}>
      <div className='relative' style={{ width: width ?? 0, height: '100%' }}>
        <LadderPinVariableVisual
          nodeId={id}
          side={data.variant === 'output' ? 'output' : 'input'}
          variableName={variableNameOf(data)}
          placeholder={placeholder}
          width={width ?? 0}
        />
      </div>
      {renderLadderHandles(data.handles)}
    </DiffWrapper>
  )
}

export function ReadOnlyParallel({ data }: NodeProps) {
  const status = diffStatusOf(data)
  return (
    <DiffWrapper status={status}>
      <div style={{ width: 1, height: 1 }} />
      {renderLadderHandles(data.handles)}
    </DiffWrapper>
  )
}

export function ReadOnlyPlaceholder({ data }: NodeProps) {
  const status = (data.diffStatus as DiffStatus) ?? 'unchanged'
  return (
    <DiffWrapper status={status}>
      <PlaceholderNodeFilled width={DEFAULT_PLACEHOLDER_WIDTH} height={DEFAULT_PLACEHOLDER_HEIGHT} />
      {renderHandles(data.handles)}
    </DiffWrapper>
  )
}

export function ReadOnlyMockNode({ data }: NodeProps) {
  const status = (data.diffStatus as DiffStatus) ?? 'unchanged'
  return (
    <DiffWrapper status={status}>
      <div className='h-[40px] w-[150px] border border-red-600 bg-white'>
        <p>{(data.label as string) ?? ''}</p>
      </div>
      {renderHandles(data.handles)}
    </DiffWrapper>
  )
}
