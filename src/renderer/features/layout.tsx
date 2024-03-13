import { Outlet } from 'react-router-dom'
import { TitleBar } from './titlebar'
import { useOpenPLCStore } from '../store'
import { useEffect, useState } from 'react'

export const AppLayout = () => {
	const [isLinux, setIsLinux] = useState(true)
	const setPlatFormData = useOpenPLCStore().setPlatFormData

	useEffect(() => {
		const setInitialData = async () => {
			const { system, theme } = await window.bridge.getSystemInfo()
			setPlatFormData({
				OS: system,
				arch: 'x64',
				colorScheme: theme,
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
			<main className='oplc-main-content'>
				<Outlet />
			</main>
		</>
	)
}
