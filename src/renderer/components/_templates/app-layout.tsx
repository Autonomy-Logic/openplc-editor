import { TitleBar } from '@root/renderer/features/titlebar'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'

type IAppLayoutProps = ComponentPropsWithoutRef<'div'>
const AppLayout = (props: IAppLayoutProps) => {
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

export { AppLayout }
