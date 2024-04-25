import { cn } from '@utils/cn'
import { ReactNode, useEffect, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

import { BottomPanel } from './bottom-panel'
import { NavigationPanel } from './navigation-panel'
import { SidebarPanel } from './sidebar-panel'

export const PanelsGroupComponent = (): ReactNode => {
  const [isLinux, setIsLinux] = useState(true)
  useEffect(() => {
    const setInitialData = async () => {
      const { OS } = await window.bridge.getSystemInfo()
      if (OS === 'darwin' || OS === 'win32') {
        setIsLinux(false)
      }
    }
    void setInitialData()
  }, [])
  return (
    <PanelGroup direction='horizontal' className='bg-brand-dark dark:bg-neutral-950'>
      <div
        className={cn(
          'flex h-full flex-grow gap-1 bg-neutral-100 p-2 dark:bg-neutral-900',
          `${isLinux ? '' : '!rounded-tl-lg'}`,
        )}
      >
        <>
          <SidebarPanel />
          {/* Here goes the sidebar component */}
          <PanelResizeHandle
          // className={`hover:bg-neutral-400 ${
          // 	isSidebarCollapsed ? 'hidden ' : ''
          // }  `}
          />
        </>
        <Panel id='workspace' order={2}>
          <PanelGroup className='flex h-full flex-grow flex-col gap-1 overflow-hidden' direction='vertical'>
            {/* Here goes the top panel component */}
            <NavigationPanel />
            {/* <EditorPanel /> */}
            {/* Here goes the editor component */}
            <PanelResizeHandle
            // className={`hover:bg-neutral-400 ${
            // 	isBottomBarCollapsed ? 'hidden ' : ''
            // } `}
            />

            <BottomPanel />
            {/* Here goes the bottom panel component */}
          </PanelGroup>
        </Panel>
      </div>
    </PanelGroup>
  )
}
