import { Handle, Position } from '@xyflow/react'

import type { DiffStatus } from '../../../../../middleware/shared/ports/version-control-port'
import { cn } from '../../../../utils/cn'
import { DIFF_BG, DIFF_RING } from './constants'

export function DiffWrapper({
  status,
  children,
  className,
}: {
  status: DiffStatus
  children: React.ReactNode
  className?: string
}) {
  if (status === 'unchanged') {
    return <div className={className}>{children}</div>
  }
  return <div className={cn('rounded', DIFF_RING[status], DIFF_BG[status], className)}>{children}</div>
}

export function renderHandles(handles: unknown) {
  if (!Array.isArray(handles)) return null
  return handles.map((h, i) => (
    <Handle
      key={i}
      id={h.id}
      type={h.type as 'source' | 'target'}
      position={h.position as Position}
      style={h.style}
      className='opacity-0'
      isConnectable={false}
    />
  ))
}

export function renderFBDHandles(handles: unknown) {
  if (!Array.isArray(handles)) return null
  return handles.map((h, i) => (
    <Handle
      key={i}
      id={h.id}
      type={h.type as 'source' | 'target'}
      position={h.position as Position}
      style={h.style}
      className={h.className}
      isConnectable={false}
    />
  ))
}
