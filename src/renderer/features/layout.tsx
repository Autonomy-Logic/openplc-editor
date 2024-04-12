import { Outlet } from 'react-router-dom'
import { TitleBar } from './titlebar'
import { useOpenPLCStore } from '../store'
import { useEffect, useState } from 'react'
import { cn } from '@utils/cn'

export const AppLayout = () => {
	const [isLinux, setIsLinux] = useState(true)
	const { setPlatFormData } = useOpenPLCStore()

	useEffect(() => {
		const setInitialData = async () => {
			const { system, theme } = await window.bridge.getSystemInfo()
			setPlatFormData({
				OS: system,
				arch: 'x64',
				shouldUseDarkMode: theme === 'dark',
			})
			if (system === 'darwin' || system === 'win32') {
				setIsLinux(false)
			}
		}
		setInitialData()
	}, [setPlatFormData])

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
