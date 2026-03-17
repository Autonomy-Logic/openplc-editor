import './style.css'

import { cn } from '@root/utils'
import type { BackgroundProps, ControlProps, ReactFlowProps } from '@xyflow/react'
import { Background, Controls, ReactFlow } from '@xyflow/react'
import { PropsWithChildren } from 'react'

type ReactFlowPanelProps = PropsWithChildren & {
  background?: boolean
  controls?: boolean

  backgroundConfig?: BackgroundProps
  controlsConfig?: ControlProps
  viewportConfig?: ReactFlowProps
}

export const ReactFlowPanel = ({
  children,
  background,
  controls = false,
  backgroundConfig,
  controlsConfig,
  viewportConfig,
}: ReactFlowPanelProps) => {
  const getDeleteKeyCodes = () => {
    if (!viewportConfig?.deleteKeyCode) return ['Delete', 'Backspace']
    return viewportConfig.deleteKeyCode
  }

  return (
    <ReactFlow deleteKeyCode={getDeleteKeyCodes()} {...viewportConfig}>
      {background && <Background {...backgroundConfig} />}
      {controls && (
        <Controls {...controlsConfig} className={cn(controlsConfig?.className)}>
          {controlsConfig?.children}
        </Controls>
      )}
      {children}
    </ReactFlow>
  )
}
