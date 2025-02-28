import {
  ArrayIcon,
  CloseIcon,
  ConfigIcon,
  DeviceTransferIcon,
  EnumIcon,
  FBDIcon,
  ILIcon,
  LDIcon,
  ResourceIcon,
  SFCIcon,
  STIcon,
  StructureIcon,
} from '@oplc-icons/index'
import type { TabsProps } from '@process:renderer/store/slices/tabs'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type ITabProps = ComponentPropsWithoutRef<'div'> & {
  fileName: string
  fileDerivation?: TabsProps['elementType']
  currentTab?: boolean
  handleDeleteTab: () => void
  handleClickedTab: () => void
}

const TabIcons = {
  ld: <LDIcon className='h-4 w-4 flex-shrink-0' />,
  sfc: <SFCIcon className='h-4 w-4 flex-shrink-0' />,
  fbd: <FBDIcon className='h-4 w-4 flex-shrink-0' />,
  st: <STIcon className='h-4 w-4 flex-shrink-0' />,
  il: <ILIcon className='h-4 w-4 flex-shrink-0' />,
  enumerated: <EnumIcon className='h-4 w-4 flex-shrink-0' />,
  structure: <StructureIcon className='h-4 w-4 flex-shrink-0' />,
  array: <ArrayIcon className='h-4 w-4 flex-shrink-0' />,
  resource: <ResourceIcon className='h-4 w-4 flex-shrink-0' />,
  configuration: <ConfigIcon className='h-4 w-4 flex-shrink-0' />,
  'pin-mapping': <DeviceTransferIcon className='h-4 w-4 flex-shrink-0' />,
}

const Tab = (props: ITabProps) => {
  const { fileName, fileDerivation, currentTab, handleDeleteTab, handleClickedTab, ...res } = props
  let languageOrDerivation:
    | 'il'
    | 'st'
    | 'resource'
    | 'ld'
    | 'sfc'
    | 'fbd'
    | 'array'
    | 'enumerated'
    | 'structure'
    | 'configuration'
    | 'pin-mapping' = 'il'

  if (fileDerivation?.type === 'data-type' || fileDerivation?.type === 'device') {
    languageOrDerivation = fileDerivation?.derivation
  }
  if (
    fileDerivation?.type === 'program' ||
    fileDerivation?.type === 'function' ||
    fileDerivation?.type === 'function-block'
  ) {
    languageOrDerivation = fileDerivation?.language
  }
  if (fileDerivation?.type === 'resource') {
    languageOrDerivation = 'resource'
  }
  return (
    <div
      role='tab'
      draggable
      className={cn(
        currentTab ? '' : 'border-r border-neutral-300 opacity-[35%]',
        'aria-[current=page]:dark:bg-brand-dark',
        'group relative flex h-[30px] min-w-0 max-w-[160px] flex-1 cursor-pointer items-center justify-between overflow-hidden bg-neutral-100 text-start font-display text-xs font-normal text-neutral-1000 dark:bg-neutral-800 dark:text-white',
      )}
      aria-current={currentTab ? 'page' : undefined}
      {...res}
    >
      <div className='flex h-full w-full items-center gap-1 px-3 py-2 ' onClick={() => handleClickedTab()}>
        {TabIcons[languageOrDerivation]}
        <span className='flex-grow overflow-hidden text-ellipsis whitespace-nowrap'>{fileName}</span>
        <span
          aria-hidden='true'
          className={cn(currentTab ? 'bg-brand' : 'bg-transparent', 'absolute inset-x-0 top-0 z-50 h-[3px]')}
        />
      </div>
      <CloseIcon
        onClick={() => handleDeleteTab()}
        className={cn(
          'absolute right-2 z-[999] hidden h-4 w-4 rounded-sm stroke-brand p-[0.25px] group-hover:block dark:stroke-brand-light ',
        )}
      />
    </div>
  )
}

export { Tab }
