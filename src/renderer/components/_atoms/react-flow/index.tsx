import type { BackgroundProps, ControlProps, ReactFlowProps } from '@xyflow/react'
import { Background, Controls, ReactFlow } from '@xyflow/react'
import { PropsWithChildren } from 'react'

type FlowPanelProps = PropsWithChildren & {
  background?: boolean
  backgroundConfig?: BackgroundProps
  controls?: boolean
  controlsConfig?: ControlProps
  controlsStyle?: string
  viewportConfig?: ReactFlowProps
}

export const FlowPanel = ({
  children,
  background,
  backgroundConfig,
  controls = false,
  controlsConfig,
  controlsStyle,
  viewportConfig,
}: FlowPanelProps) => {
  return (
    <ReactFlow {...viewportConfig}>
      {background && <Background {...backgroundConfig} />}
      {controls && <Controls {...controlsConfig} className={controlsStyle} />}
      {children}
    </ReactFlow>
  )
}
