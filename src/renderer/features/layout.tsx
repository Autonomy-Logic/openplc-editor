import { Outlet } from 'react-router-dom'
import { TitleBar } from './titlebar'
import { useOpenPLCStore } from '../store'
import { useEffect, useState } from 'react'
import { cn } from '@utils/cn'

export const AppLayout = () => {
	const [isLinux, setIsLinux] = useState(true)
	const {
		workspaceActions: { setSystemConfigs },
	} = useOpenPLCStore()

	useEffect(() => {
		const getUserSystemProps = async () => {
			const { OS, architecture, prefersDarkMode } =
				await window.bridge.getSystemInfo()
			setSystemConfigs({
				OS,
				arch: architecture,
				shouldUseDarkMode: prefersDarkMode,
			})
			if (OS === 'darwin' || OS === 'win32') {
				setIsLinux(false)
			}
		}
		getUserSystemProps()
	}, [setSystemConfigs])

	return (
		<>
			{!isLinux && <TitleBar />}
			<main
				className={cn(
					'absolute flex left-0 right-0 bottom-0 overflow-hidden',
					`${isLinux ? 'top-0' : 'top-[--oplc-title-bar-height]'}`
				)}
			>
				<Outlet />
			</main>
		</>
	)
}
