import { Outlet } from 'react-router-dom'
import { TitleBar } from './titlebar'
import { useOpenPLCStore } from '../store'
import { useEffect } from 'react'

export const AppLayout = () => {
	const setPlatFormData = useOpenPLCStore().setPlatFormData

	useEffect(() => {
		const setInitialData = async () => {
			const systemInfo = await window.bridge.getOSInfo()
			setPlatFormData({
				platformName: systemInfo,
				platformType: 'x64',
			})
		}
		setInitialData()
	}, [setPlatFormData])

	return (
		<>
			<TitleBar />
			<main className='oplc-main-content'>
				<Outlet />
			</main>
		</>
	)
}
