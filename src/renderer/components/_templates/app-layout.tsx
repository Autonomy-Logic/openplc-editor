import { TitleBar } from '@root/renderer/components/_organisms/title-bar'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { ReactNode, useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'

import Toaster from '../_features/[app]/toast/toaster'

// type IAppLayoutProps = ComponentPropsWithoutRef<'div'>
const AppLayout = (): ReactNode => {
  const [isLinux, setIsLinux] = useState(true)
  const {
    workspaceActions: { setSystemConfigs, switchAppTheme, toggleMaximizedWindow },
    project,
  } = useOpenPLCStore()

  useEffect(() => {
    const getUserSystemProps = async () => {
      const { OS, architecture, prefersDarkMode, isWindowMaximized } = await window.bridge.getSystemInfo()
      setSystemConfigs({
        OS,
        arch: architecture,
        shouldUseDarkMode: prefersDarkMode,
        isWindowMaximized,
      })
      if (OS === 'darwin' || OS === 'win32') {
        setIsLinux(false)
      }
    }
    void getUserSystemProps()
  }, [setSystemConfigs])

  useEffect(() => {
    window.bridge.isMaximizedWindow((_event) => {
      toggleMaximizedWindow()
    })
  }, [])

  useEffect(() => {
    window.bridge.handleUpdateTheme((_event) => {
      switchAppTheme()
    })
  }, [])

  useEffect(() => {
    console.log('PROJETOS')
    console.log(project)
  }, [project])

  return (
    <>
      {!isLinux && <TitleBar />}
      <main
        className={cn(
          'absolute bottom-0 left-0 right-0 flex overflow-hidden',
          `${isLinux ? 'top-0' : 'top-[--oplc-title-bar-height]'}`,
        )}
      >
        <Outlet />
        <Toaster />
      </main>
    </>
  )
}

export { AppLayout }
