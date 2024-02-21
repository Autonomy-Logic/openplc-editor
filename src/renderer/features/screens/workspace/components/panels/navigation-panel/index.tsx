import { ReactNode } from 'react'
import { NavigationPanelTabs } from './tabs'
import { NavigationPanelBreadcrumbs } from './breadcrumbs'

export const NavigationPanel = (): ReactNode => {
	return (
		<div className='w-full h-[70px] border-neutral-200 rounded-lg mb-1 bg-white border'>
			<NavigationPanelTabs />
			<NavigationPanelBreadcrumbs />
		</div>
	)
}
