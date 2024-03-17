import { ComponentProps } from 'react'
import { ArrowIcon, PLCIcon } from '@process:renderer/assets'
import {
	LanguageIcon,
	LanguageIconType,
	PouIconType,
	PouIcon,
} from '@process:renderer/data'

type INavigationPanelBreadcrumbsProps = ComponentProps<'ol'> & {
	crumb: {
		key: string
		project_name: string
		pou_to_display: {
			name: string
			type: [keyof PouIconType]
			language: [keyof LanguageIconType]
		}
	}
}

export const NavigationPanelBreadcrumbs = (
	props: INavigationPanelBreadcrumbsProps
) => {
	const { crumb, className, ...res } = props
	const PouName = crumb.pou_to_display.name
	const PouType = crumb.pou_to_display.type[0]
	const PouLanguage = crumb.pou_to_display.language[0]
	const IconForType = PouIcon[PouType]
	const IconForLang = LanguageIcon[PouLanguage]
	return (
		<ol className='flex h-1/2 cursor-default items-center p-2 select-none'>
			{/** Project Name */}
			<li key={crumb.key}>
				<div className='flex items-center gap-1'>
					<PLCIcon
						className='h-4 w-4 flex-shrink-0'
						aria-hidden='true'
						role='img'
					/>
					<span className='font-caption text-[10px] text-neutral-850 dark:text-neutral-300 font-medium'>
						{crumb.project_name}
					</span>
					<ArrowIcon
						direction='right'
						className='h-3 w-3 flex-shrink-0 stroke-brand-light'
						aria-hidden='true'
						role='img'
					/>
				</div>
			</li>
			{/** Pou type and associated Icon */}
			<li>
				<div className='flex items-center gap-1'>
					{/** Icon */}
					<IconForType
						className='h-4 w-4 flex-shrink-0'
						aria-hidden='true'
						role='img'
					/>
					<span className='font-caption text-[10px] text-neutral-850 dark:text-neutral-300 font-medium'>
						{/** Text */}
						{PouType}
					</span>
					<ArrowIcon
						direction='right'
						className='h-3 w-3 flex-shrink-0 stroke-brand-light'
						aria-hidden='true'
						role='img'
					/>
				</div>
			</li>
			{/** Pou language and associated Icon */}
			<li>
				<div className='flex items-center gap-1'>
					{/** Icon */}
					<IconForLang
						className='h-4 w-4 flex-shrink-0'
						aria-hidden='true'
						role='img'
					/>
					<span className='font-caption text-[10px] text-neutral-850 dark:text-neutral-300 font-medium'>
						{/** Text */}
						{PouName}
					</span>
				</div>
			</li>
		</ol>
	)
}
