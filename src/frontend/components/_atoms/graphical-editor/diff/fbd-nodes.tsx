import type { NodeProps } from '@xyflow/react'

import type { DiffStatus } from '../../../../../middleware/shared/ports/version-control-port'
import { BlockNodeVisual } from '../fbd/block-visual'
import { CommentVisual } from '../fbd/comment-visual'
import { ConnectionVisual } from '../fbd/connection-visual'
import { VariableVisual } from '../fbd/variable-visual'
import { DiffWrapper, renderFBDHandles } from './diff-wrapper'

export function ReadOnlyFBDBlock({ data, width, height }: NodeProps) {
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
            <div className='truncate text-center text-xs leading-3 text-neutral-400'>{varName}</div>
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
      {renderFBDHandles(data.handles)}
    </DiffWrapper>
  )
}

export function ReadOnlyFBDVariable({ data }: NodeProps) {
  const status = (data.diffStatus as DiffStatus) ?? 'unchanged'
  const varName = (data.variable as { name?: string })?.name ?? ''

  return (
    <DiffWrapper status={status}>
      <VariableVisual variableName={varName} />
      {renderFBDHandles(data.handles)}
    </DiffWrapper>
  )
}

export function ReadOnlyConnector({ data }: NodeProps) {
  const status = (data.diffStatus as DiffStatus) ?? 'unchanged'
  const variantType = (data.nodeType as string) ?? 'connector'
  const name = (data.variable as { name?: string })?.name ?? (data.name as string) ?? ''

  return (
    <DiffWrapper status={status}>
      <ConnectionVisual variant={variantType === 'continuation' ? 'continuation' : 'connector'} name={name} />
      {renderFBDHandles(data.handles)}
    </DiffWrapper>
  )
}

export function ReadOnlyComment({ data, width, height }: NodeProps) {
  const status = (data.diffStatus as DiffStatus) ?? 'unchanged'
  const content = (data.content as string) ?? (data.comment as string) ?? ''

  return (
    <DiffWrapper status={status}>
      <CommentVisual content={content} width={width as number} height={height as number} />
      {renderFBDHandles(data.handles)}
    </DiffWrapper>
  )
}
