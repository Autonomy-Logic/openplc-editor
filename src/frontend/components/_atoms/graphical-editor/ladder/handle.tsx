import { Handle, HandleProps } from '@xyflow/react'
import type { CSSProperties } from 'react'

import { cn } from '../../../../utils/cn'

export type CustomHandleProps = HandleProps & {
  /** ladder handles always carry an explicit id — strip the `null` xyflow ≥12.11 allows */
  id?: string
  glbPosition: {
    x: number
    y: number
  }
  relPosition: {
    x: number
    y: number
  }
}

export const CustomHandle = ({
  id,
  className,
  style,
  type,
  position,
  isConnectable,
  glbPosition: _glb,
  relPosition: _rel,
  ...props
}: CustomHandleProps) => {
  return (
    <Handle
      id={id}
      position={position}
      type={type}
      isConnectable={isConnectable}
      style={style}
      className={cn('opacity-0', className)}
      {...props}
    />
  )
}

/**
 * Inline style that puts a ladder handle, as a 1 px point, on its stored relative position shifted by `dx`; the
 * handle's own style when it has no relative position.
 */
export function ladderHandleStyle(
  handle: { relPosition?: unknown; style?: CSSProperties },
  dx = 0,
): CSSProperties | undefined {
  const rel: unknown = handle.relPosition
  if (typeof rel !== 'object' || rel === null || !('x' in rel) || !('y' in rel)) return handle.style
  if (typeof rel.x !== 'number' || typeof rel.y !== 'number') return handle.style
  return {
    left: rel.x + dx,
    top: rel.y,
    right: 'auto',
    bottom: 'auto',
    width: 1,
    height: 1,
    minWidth: 1,
    minHeight: 1,
    borderWidth: 0,
    transform: 'translate(-50%, -50%)',
  }
}

type BuildHandleProps = Omit<CustomHandleProps, 'glbPosition' | 'relPosition'> & {
  glbX: number
  glbY: number
  relX: number
  relY: number
}
/**
 *
 * @param glbX: number - The x coordinate of the handle based on the global position (inside the flow panel)
 * @param glbY: number - The y coordinate of the handle based on the global position (inside the flow panel)
 * @param relX: number - The x coordinate of the handle based on the relative position (inside the node)
 * @param relY: number - The y coordinate of the handle based on the relative position (inside the node)
 * @returns CustomHandleProps
 */
export const buildHandle = ({ glbX, glbY, relX, relY, ...rest }: BuildHandleProps): CustomHandleProps => {
  return {
    glbPosition: {
      x: glbX,
      y: glbY,
    },
    relPosition: {
      x: relX,
      y: relY,
    },
    ...rest,
  }
}
