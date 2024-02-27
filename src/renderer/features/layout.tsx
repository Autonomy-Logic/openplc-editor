import { Outlet } from 'react-router-dom'
import { TitleBar } from './titlebar'

export const AppLayout = () => {
	return (
		<>
			<TitleBar />
			<main className='oplc-main-content'>
				<Outlet />
			</main>
		</>
	)
}
