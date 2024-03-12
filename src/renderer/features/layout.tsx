import { Outlet } from 'react-router-dom'
import { TitleBar } from './titlebar'
import { useOpenPLCStore } from '../store'
import { useEffect, useState } from 'react'
import {cn} from '~/utils/index'

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
			<main className={cn('absolute flex left-0 right-0 bottom-0 overflow-hidden', `${isLinux ? 'top-0' : 'top-[--oplc-title-bar-height]'}`)}>
				<Outlet />
			</main>
		</>
	)
}
