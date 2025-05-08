/**
 * This need to be refactored!!!!
 */
import { ArrowIcon, ConfigIcon, PLCIcon } from '@process:renderer/assets'
import { LanguageIcon, LanguageIconType, PouIcon, PouIconType } from '@process:renderer/data'
import { ArrayIcon, EnumIcon, StructureIcon } from '@root/renderer/assets'
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
    project: {
      meta: { name },
      data: { dataTypes },
    },
  } = useOpenPLCStore()

  const derivationIcons = {
    enumerated: EnumIcon,
    structure: StructureIcon,
    array: ArrayIcon,
    configuration: ConfigIcon,
  }

  const getPouTypeOrDataTypeOrResource = ():
    | ['program' | 'function' | 'function-block' | 'resource' | 'data-type' | 'device']
    | null => {
    if ('pouType' in meta) {
      return [meta.pouType] as ['program' | 'function' | 'function-block']
    }
    if (dataTypes.find((datatype) => datatype.name === meta.name)) {
      return ['data-type']
    }
    if (meta.name === 'Configuration' || meta.name === 'Pin Mapping') {
      return ['device']
    }
    return ['resource']
  }

  const getIconOrLanguage = (): [React.ElementType, string] => {
    const dataTypeDerivation = dataTypes.find((datatype) => datatype.name === meta.name)?.derivation
    if (dataTypeDerivation) {
      return [derivationIcons[dataTypeDerivation], dataTypeDerivation]
    }
    const deviceTypeDerivation = meta.name === 'Configuration' ? 'configuration' : null
    if (deviceTypeDerivation) {
      return [derivationIcons[deviceTypeDerivation], deviceTypeDerivation]
    }
    if ('language' in meta) {
      return [LanguageIcon[meta.language], meta.language]
    }
    return [LanguageIcon.st, 'st']
  }

  const typeOrIcon = getPouTypeOrDataTypeOrResource()
  const [icon, text] = getIconOrLanguage()

  return (
    <NavigationPanelBreadcrumbs
      crumb={{
        project_name: name,
        pou_to_display: {
          name: meta.name,
          type: Array.isArray(typeOrIcon) ? typeOrIcon : ['data-type'],
          language: [text as 'st' | 'il' | 'ld' | 'fbd' | 'sfc'],
        },
      }}
      typeIcon={icon}
    />
  )
}

export { Breadcrumbs }

const BreadcrumbItem = ({ Icon, text, isLast }: { Icon: React.ElementType; text: string; isLast?: boolean }) => (
  <div className='flex items-center gap-1'>
    <Icon className='h-4 w-4 flex-shrink-0' aria-hidden='true' role='img' />
    <span className='font-caption text-[10px] font-medium text-neutral-850 dark:text-neutral-300'>{text}</span>
    {!isLast && (
      <ArrowIcon direction='right' className='h-3 w-3 flex-shrink-0 stroke-brand-light' aria-hidden='true' role='img' />
    )}
  </div>
)

export const NavigationPanelBreadcrumbs = ({
  crumb,
  typeIcon,
  ...res
}: INavigationPanelBreadcrumbsProps & { typeIcon?: React.ElementType }) => {
  const { project_name, pou_to_display } = crumb
  const { name, type, language } = pou_to_display
  const isResource = type[0] === 'resource'

  return (
    <ol className='flex h-1/2 cursor-default select-none items-center p-2' {...res}>
      <li>
        <BreadcrumbItem Icon={PLCIcon} text={project_name} isLast={false} />
      </li>
      <li>
        <BreadcrumbItem Icon={PouIcon[type[0]]} text={_.startCase(type[0])} isLast={isResource} />
      </li>
      {!isResource && (
        <li>
          {typeIcon ? (
            <BreadcrumbItem Icon={typeIcon} text={name} isLast={true} />
          ) : (
            <BreadcrumbItem Icon={LanguageIcon[language[0]]} text={name} isLast={true} />
          )}
        </li>
      )}
    </ol>
  )
}
