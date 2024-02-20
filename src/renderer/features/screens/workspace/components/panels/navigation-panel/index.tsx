import { ReactNode } from 'react'
import { NavigationPanelTabs } from './tabs'
import { NavigationPanelBreadcrumbs } from './breadcrumbs'

const TestData = {
	key: '1',
	project_name: 'Project Name',
	pou_to_display: {
		name: 'Pou Name',
		type: ['function'],
		language: ['ld'],
	},
}

export const NavigationPanel = (): ReactNode => {
	return (
		<div className='w-full h-[70px] border-neutral-200 rounded-lg mb-1 bg-white border'>
			<NavigationPanelTabs />
			<NavigationPanelBreadcrumbs
				crumb={{
					key: '1',
					project_name: 'Project Name',
					pou_to_display: {
						name: 'Pou Name',
						type: ['program'],
						language: ['ld'],
					},
				}}
			/>
		</div>
	)
}
