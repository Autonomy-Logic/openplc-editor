import { cn } from '@root/utils'
import { Handle, HandleProps } from '@xyflow/react'

export type CustomHandleProps = HandleProps & {
  glbPosition: {
    x: number
    y: number
  }
  relPosition: {
    x: number
    y: number
  }
}

export const CustomHandle = ({ id, className, style, type, position, isConnectable }: CustomHandleProps) => {
  return (
    <Handle
      id={id}
      position={position}
      type={type}
      isConnectable={isConnectable}
      style={style}
      className={cn('opacity-0', className)}
    />
  )
}

type BuildHandleProps = HandleProps & {
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
export const buildHandle = ({ glbX, glbY, relX, relY, ...rest }: BuildHandleProps) => {
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
