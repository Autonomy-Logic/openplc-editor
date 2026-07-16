import './style.css'

import type { BackgroundProps, ControlProps, ReactFlowProps } from '@xyflow/react'
import { Background, Controls, ReactFlow } from '@xyflow/react'
import { PropsWithChildren, useMemo } from 'react'

import { cn } from '../../../utils/cn'

type ReactFlowPanelProps = PropsWithChildren & {
  background?: boolean
  controls?: boolean
  backgroundConfig?: BackgroundProps
  controlsConfig?: ControlProps
  viewportConfig?: ReactFlowProps
}

const DEFAULT_DELETE_KEY_CODES = ['Delete', 'Backspace']

export const ReactFlowPanel = ({
  children,
  background,
  controls = false,
  backgroundConfig,
  controlsConfig,
  viewportConfig,
}: ReactFlowPanelProps) => {
  const deleteKeyCodes = viewportConfig?.deleteKeyCode ? viewportConfig.deleteKeyCode : DEFAULT_DELETE_KEY_CODES

  // Stable children identity — inline JSX would break FlowRenderer's memo.
  const flowChildren = useMemo(
    () => (
      <>
        {background && <Background {...backgroundConfig} />}
        {controls && (
          <Controls {...controlsConfig} className={cn(controlsConfig?.className)}>
            {controlsConfig?.children}
          </Controls>
        )}
        {children}
      </>
    ),
    [background, backgroundConfig, controls, controlsConfig, children],
  )

  return (
    <ReactFlow deleteKeyCode={deleteKeyCodes} {...viewportConfig}>
      {flowChildren}
    </ReactFlow>
  )
}
