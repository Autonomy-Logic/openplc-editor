import { Outlet } from 'react-router-dom'
import { TitleBar } from './titlebar'
import { useOpenPLCStore } from '../store'
import { useEffect, useState } from 'react'

export const AppLayout = () => {
	const [isLinux, setIsLinux] = useState(true)
	const setPlatFormData = useOpenPLCStore().setPlatFormData

	useEffect(() => {
		const setInitialData = async () => {
			const systemInfo = await window.bridge.getOSInfo()
			setPlatFormData({
				platformName: systemInfo,
				platformType: 'x64',
			})
			if (systemInfo === 'darwin' || systemInfo === 'win32') {
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
