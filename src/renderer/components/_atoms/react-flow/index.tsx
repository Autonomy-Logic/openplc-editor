import '@xyflow/react/dist/style.css'

import type { BackgroundProps, ControlProps, ReactFlowProps } from '@xyflow/react'
import { Background, Controls, ReactFlow } from '@xyflow/react'
import { PropsWithChildren } from 'react'

type FlowPanelProps = PropsWithChildren & {
  background?: boolean
  backgroundConfig?: BackgroundProps
  controls?: boolean
  controlsConfig?: ControlProps
  constrolsStyle?: string
  viewportConfig?: ReactFlowProps
}

export const FlowPanel = ({
  children,
  background,
  backgroundConfig,
  controls = false,
  controlsConfig,
  constrolsStyle,
  viewportConfig,
}: FlowPanelProps) => {
  return (
    <ReactFlow {...viewportConfig}>
      {background && <Background {...backgroundConfig} />}
      {controls && <Controls {...controlsConfig} className={constrolsStyle} />}
      {children}
    </ReactFlow>
  )
}
