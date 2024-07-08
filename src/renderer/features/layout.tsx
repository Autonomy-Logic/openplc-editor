import { cn } from '@utils/cn'
import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'

import { useOpenPLCStore } from '../store'
import { TitleBar } from './titlebar'

export const AppLayout = () => {
  const [isLinux, setIsLinux] = useState(true)
  const {
    workspaceActions: { setSystemConfigs },
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
      </main>
    </>
  )
}
