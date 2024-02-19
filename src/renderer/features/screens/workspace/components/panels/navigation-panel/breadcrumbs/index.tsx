import { ArrowIcon, PLCIcon } from '~/renderer/assets'

const pages = [
	{ name: 'Project Name', href: '#', current: false },
	{ name: 'LD Program', href: '#', current: false },
	{ name: 'ST Function', href: '#', current: true },
]
export const NavigationPanelBreadcrumbs = () => {
	return (
		<nav className='flex h-1/2' aria-label='Breadcrumb'>
			<ol className='flex items-center space-x-4'>
				<li>
					<div>
						{/* biome-ignore lint/a11y/useValidAnchor: <explanation> */}
						<a className='text-gray-400 hover:text-gray-500'>
							<PLCIcon className='h-5 w-5 flex-shrink-0' aria-hidden='true' />
							<span className='sr-only'>Home</span>
						</a>
					</div>
				</li>
				{pages.map((page) => (
					<li key={page.name}>
						<div className='flex items-center'>
							<ArrowIcon
								className='h-5 w-5 flex-shrink-0 text-gray-400'
								aria-hidden='true'
							/>
							<a
								href={page.href}
								className='ml-4 text-sm font-medium text-gray-500 hover:text-gray-700'
								aria-current={page.current ? 'page' : undefined}
							>
								{page.name}
							</a>
						</div>
					</li>
				))}
			</ol>
		</nav>
	)
}
