import { Handle, HandleProps } from '@xyflow/react'

export type CustomHandleProps = HandleProps & {
  x: number
  y: number
}

export const CustomHandle = ({ id, style, type, position, isConnectable }: CustomHandleProps) => {
  return <Handle id={id} position={position} type={type} isConnectable={isConnectable} style={style} />
}
