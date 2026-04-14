import type { NodeProps } from '@xyflow/react'

import type { DiffStatus } from '../../../../../middleware/shared/ports/version-control-port'
import { PlaceholderNodeFilled } from '../../../../assets/icons/flow/Placeholder'
import { BlockNodeVisual } from '../ladder/block-visual'
import { CoilVisual } from '../ladder/coil-visual'
import { ContactVisual } from '../ladder/contact-visual'
import {
  DEFAULT_PARALLEL_HEIGHT,
  DEFAULT_PARALLEL_WIDTH,
  DEFAULT_PLACEHOLDER_HEIGHT,
  DEFAULT_PLACEHOLDER_WIDTH,
  DEFAULT_POWER_RAIL_HEIGHT,
  DEFAULT_POWER_RAIL_WIDTH,
} from '../ladder/utils/constants'
import { VariableVisual } from '../ladder/variable-visual'
import { DiffWrapper, renderHandles } from './diff-wrapper'

export function ReadOnlyPowerRail({ data }: NodeProps) {
  const status = (data.diffStatus as DiffStatus) ?? 'unchanged'
  return (
    <DiffWrapper status={status}>
      <svg width={DEFAULT_POWER_RAIL_WIDTH} height={DEFAULT_POWER_RAIL_HEIGHT} xmlns='http://www.w3.org/2000/svg'>
        <rect width={DEFAULT_POWER_RAIL_WIDTH} height={DEFAULT_POWER_RAIL_HEIGHT} className='fill-neutral-500' />
      </svg>
      {renderHandles(data.handles)}
    </DiffWrapper>
  )
}

export function ReadOnlyContact({ data }: NodeProps) {
  const status = (data.diffStatus as DiffStatus) ?? 'unchanged'
  const varName = (data.variable as { name?: string })?.name
  const variant = (data.variant as string) ?? 'default'
  return (
    <DiffWrapper status={status}>
      <ContactVisual variant={variant} variableName={varName} className='hover:outline-none' />
      {renderHandles(data.handles)}
    </DiffWrapper>
  )
}

export function ReadOnlyCoil({ data }: NodeProps) {
  const status = (data.diffStatus as DiffStatus) ?? 'unchanged'
  const varName = (data.variable as { name?: string })?.name
  const variant = (data.variant as string) ?? 'default'
  return (
    <DiffWrapper status={status}>
      <CoilVisual variant={variant} variableName={varName} className='hover:outline-none' />
      {renderHandles(data.handles)}
    </DiffWrapper>
  )
}

export function ReadOnlyBlock({ data, width, height }: NodeProps) {
  const status = (data.diffStatus as DiffStatus) ?? 'unchanged'
  const variant = data.variant as
    | { name?: string; type?: string; variables?: Array<{ name: string; class: string }> }
    | undefined
  const blockName = variant?.name ?? '???'
  const blockType = variant?.type ?? ''
  const blockVars = variant?.variables ?? []
  const inputs = blockVars.filter((v) => v.class === 'input' || v.class === 'inOut').map((v) => v.name)
  const outputs = blockVars.filter((v) => v.class === 'output' || v.class === 'inOut').map((v) => v.name)
  const varName = (data.variable as { name?: string })?.name ?? ''
  const showInstanceName = blockType !== 'function' && blockType !== 'generic' && varName
  const w = (width as number) ?? 216
  const h = (height as number) ?? 128

  return (
    <DiffWrapper status={status}>
      <div className='relative'>
        {showInstanceName && (
          <div className='absolute -top-[16px]' style={{ width: w }}>
            <div className='truncate text-center text-xs leading-3 text-neutral-500'>{varName}</div>
          </div>
        )}
        <BlockNodeVisual
          blockName={blockName}
          inputConnectors={inputs}
          outputConnectors={outputs}
          width={w}
          height={h}
          disabled
        />
      </div>
      {renderHandles(data.handles)}
    </DiffWrapper>
  )
}

export function ReadOnlyVariable({ data }: NodeProps) {
  const status = (data.diffStatus as DiffStatus) ?? 'unchanged'
  const varName = (data.variable as { name?: string })?.name ?? ''
  const blockData = data.block as { variableType?: { type?: { value?: string } } } | undefined
  const typeValue = blockData?.variableType?.type?.value
  const placeholder = typeValue ? `(*${typeValue}*)` : ''

  return (
    <DiffWrapper status={status}>
      <VariableVisual variableName={varName} placeholder={placeholder} variant={(data.variant as string) ?? ''} />
      {renderHandles(data.handles)}
    </DiffWrapper>
  )
}

export function ReadOnlyParallel({ data }: NodeProps) {
  const status = (data.diffStatus as DiffStatus) ?? 'unchanged'
  return (
    <DiffWrapper status={status}>
      <div style={{ width: DEFAULT_PARALLEL_WIDTH, height: DEFAULT_PARALLEL_HEIGHT }}>
        <svg style={{ width: DEFAULT_PARALLEL_WIDTH, height: DEFAULT_PARALLEL_HEIGHT }}>
          <rect
            width={DEFAULT_PARALLEL_WIDTH}
            height={DEFAULT_PARALLEL_HEIGHT}
            className='stroke-[--xy-edge-stroke-default]'
            fill='none'
          />
        </svg>
      </div>
      {renderHandles(data.handles)}
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
