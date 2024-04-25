import { ReactNode, useState } from 'react'
import { Panel } from 'react-resizable-panels'

export const BottomPanel = (): ReactNode => {
  const [isBottomBarCollapsed, setIsBottomBarCollapsed] = useState(false)
  return (
    <Panel
      onCollapse={() => setIsBottomBarCollapsed(true)}
      onExpand={() => setIsBottomBarCollapsed(false)}
      collapsible={true}
      collapsedSize={0}
      id='bottomPanel'
      minSize={22}
      defaultSize={22}
      className={`rounded-lg border-2 border-neutral-200 bg-white dark:bg-neutral-950  ${
        isBottomBarCollapsed ? 'border-none ' : ''
      }`}
    />
  )
}
