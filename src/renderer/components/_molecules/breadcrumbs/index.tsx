/**
 * This need to be refactored!!!!
 */
import { ArrowIcon, PLCIcon } from '@process:renderer/assets'
import { LanguageIcon, LanguageIconType, PouIcon, PouIconType } from '@process:renderer/data'
import { useOpenPLCStore } from '@root/renderer/store'
import _ from 'lodash'
import { ComponentProps } from 'react'

type INavigationPanelBreadcrumbsProps = ComponentProps<'ol'> & {
  crumb: {
    project_name: string
    pou_to_display: {
      name: string
      type: [keyof PouIconType]
      language: [keyof LanguageIconType]
    }
  }
}

const Breadcrumbs = () => {
  const {
    editor: { meta },
    workspace: {
      projectData: { projectName },
    },
  } = useOpenPLCStore()

  return (
    <NavigationPanelBreadcrumbs
      crumb={{
        project_name: projectName,
        pou_to_display: {
          name: meta.name,
          type: ['pouType' in meta ? meta.pouType : 'data-type'],
          language: 'language' in meta ? [meta.language] : ['st'],
        },
      }}
    />
  )
}

export { Breadcrumbs }

const BreadcrumbItem = ({ Icon, text }: { Icon: React.ElementType; text: string }) => (
  <div className='flex items-center gap-1'>
    <Icon className='h-4 w-4 flex-shrink-0' aria-hidden='true' role='img' />
    <span className='font-caption text-[10px] font-medium text-neutral-850 dark:text-neutral-300'>{text}</span>
    <ArrowIcon direction='right' className='h-3 w-3 flex-shrink-0 stroke-brand-light' aria-hidden='true' role='img' />
  </div>
)

export const NavigationPanelBreadcrumbs = ({ crumb, ...res }: INavigationPanelBreadcrumbsProps) => {
  const { project_name, pou_to_display } = crumb
  const { name, type, language } = pou_to_display

  return (
    <ol className='flex h-1/2 cursor-default select-none items-center p-2' {...res}>
      <li>
        <BreadcrumbItem Icon={PLCIcon} text={project_name} />
      </li>
      <li>
        <BreadcrumbItem Icon={PouIcon[type[0]]} text={_.startCase(type[0])} />
      </li>
      <li>
        <BreadcrumbItem Icon={LanguageIcon[language[0]]} text={name} />
      </li>
    </ol>
  )
}
