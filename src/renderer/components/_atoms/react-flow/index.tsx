import type { BackgroundProps, ControlProps, ReactFlowProps } from '@xyflow/react'
import { Background, Controls, ReactFlow } from '@xyflow/react'
import { PropsWithChildren } from 'react'

type ReactFlowPanelProps = PropsWithChildren & {
  background?: boolean
  backgroundConfig?: BackgroundProps
  controls?: boolean
  controlsConfig?: ControlProps
  controlsStyle?: string
  viewportConfig?: ReactFlowProps
}

export const ReactFlowPanel = ({
  children,
  background,
  backgroundConfig,
  controls = false,
  controlsConfig,
  controlsStyle,
  viewportConfig,
}: ReactFlowPanelProps) => {

  const getDeleteKeyCodes = () => {
    if (!viewportConfig?.deleteKeyCode) return ['Delete', 'Backspace']
    return viewportConfig.deleteKeyCode
  }

  return (
    <ReactFlow
      deleteKeyCode={getDeleteKeyCodes()}
      {...viewportConfig}
    >
      {background && <Background {...backgroundConfig} />}
      {controls && <Controls {...controlsConfig} className={controlsStyle} />}
      {children}
    </ReactFlow>
  )
}
