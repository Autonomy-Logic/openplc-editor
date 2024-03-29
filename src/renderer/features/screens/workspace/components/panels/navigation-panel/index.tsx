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
		<div className='w-full h-[70px] overflow-hidden border-neutral-200 dark:border-neutral-850 rounded-lg bg-white dark:bg-neutral-950 border-2'>
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
