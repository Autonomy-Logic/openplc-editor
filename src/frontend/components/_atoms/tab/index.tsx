import { GitCompare } from 'lucide-react'
import type React from 'react'
import { ComponentPropsWithoutRef, useCallback } from 'react'

import { CloseIcon } from '../../../assets/icons/interface/Close'
import { ConfigIcon } from '../../../assets/icons/interface/Config'
import { DeviceTransferIcon } from '../../../assets/icons/interface/DeviceTransfer'
import { ArrayIcon } from '../../../assets/icons/project/Array'
import { CppIcon } from '../../../assets/icons/project/Cpp'
import { EnumIcon } from '../../../assets/icons/project/Enum'
import { FBDIcon } from '../../../assets/icons/project/FBD'
import { ILIcon } from '../../../assets/icons/project/IL'
import { LDIcon } from '../../../assets/icons/project/LD'
import { LibraryIcon } from '../../../assets/icons/project/Library'
import { LibraryManifestIcon } from '../../../assets/icons/project/LibraryManifest'
import { OrchestratorIcon } from '../../../assets/icons/project/Orchestrator'
import { PythonIcon } from '../../../assets/icons/project/Python'
import { RemoteDeviceIcon } from '../../../assets/icons/project/RemoteDevice'
import { ResourceIcon } from '../../../assets/icons/project/Resource'
import { ServerIcon } from '../../../assets/icons/project/Server'
import { SFCIcon } from '../../../assets/icons/project/SFC'
import { STIcon } from '../../../assets/icons/project/ST'
import { StructureIcon } from '../../../assets/icons/project/Structure'
import { useOpenPLCStore } from '../../../store'
import type { TabsProps } from '../../../store/slices/tabs'
import { cn } from '../../../utils/cn'
import { isUnsaved, unsavedLabel } from '../../../utils/unsaved-label'

type ITabProps = ComponentPropsWithoutRef<'div'> & {
  fileName: string
  fileDerivation?: TabsProps['elementType']
  currentTab?: boolean
  handleDeleteTab: () => void
  handleClickedTab: () => void
}

const TabIcons: Record<string, React.ReactNode> = {
  ld: <LDIcon className='h-4 w-4 flex-shrink-0' />,
  sfc: <SFCIcon className='h-4 w-4 flex-shrink-0' />,
  fbd: <FBDIcon className='h-4 w-4 flex-shrink-0' />,
  st: <STIcon className='h-4 w-4 flex-shrink-0' />,
  il: <ILIcon className='h-4 w-4 flex-shrink-0' />,
  python: <PythonIcon className='h-4 w-4 flex-shrink-0' />,
  cpp: <CppIcon className='h-4 w-4 flex-shrink-0' />,
  enumerated: <EnumIcon className='h-4 w-4 flex-shrink-0' />,
  structure: <StructureIcon className='h-4 w-4 flex-shrink-0' />,
  array: <ArrayIcon className='h-4 w-4 flex-shrink-0' />,
  resource: <ResourceIcon className='h-4 w-4 flex-shrink-0' />,
  configuration: <ConfigIcon className='h-4 w-4 flex-shrink-0' />,
  'pin-mapping': <DeviceTransferIcon className='h-4 w-4 flex-shrink-0' />,
  orchestrators: <OrchestratorIcon className='h-4 w-4 flex-shrink-0' />,
  'remote-device': <RemoteDeviceIcon className='h-4 w-4 flex-shrink-0' />,
  server: <ServerIcon className='h-4 w-4 flex-shrink-0' />,
  'vendor-screen': <ConfigIcon className='h-4 w-4 flex-shrink-0' />,
  'package-manager': <ConfigIcon className='h-4 w-4 flex-shrink-0' />,
  'ethercat-device': <DeviceTransferIcon className='h-4 w-4 flex-shrink-0' />,
  'library-manager': <LibraryIcon className='h-4 w-4 flex-shrink-0' />,
  'library-manifest': <LibraryManifestIcon className='h-4 w-4 flex-shrink-0' />,
  'diff-viewer': <GitCompare className='h-4 w-4 flex-shrink-0 text-[#0464FB]' />,
}

const Tab = (props: ITabProps) => {
  const {
    fileActions: { getFile },
  } = useOpenPLCStore()

  const { fileName, fileDerivation, currentTab, handleDeleteTab, handleClickedTab, ...res } = props
  let languageOrDerivation:
    | 'il'
    | 'st'
    | 'python'
    | 'cpp'
    | 'resource'
    | 'ld'
    | 'sfc'
    | 'fbd'
    | 'array'
    | 'enumerated'
    | 'structure'
    | 'configuration'
    | 'pin-mapping'
    | 'orchestrators'
    | 'remote-device'
    | 'server'
    | 'vendor-screen'
    | 'package-manager'
    | 'ethercat-device'
    | 'library-manager'
    | 'library-manifest'
    | 'diff-viewer' = 'il'

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
  if (fileDerivation?.type === 'remote-device') {
    languageOrDerivation = 'remote-device'
  }
  if (fileDerivation?.type === 'server') {
    languageOrDerivation = 'server'
  }
  if (fileDerivation?.type === 'vendor-screen') {
    languageOrDerivation = 'vendor-screen'
  }
  if (fileDerivation?.type === 'package-manager') {
    languageOrDerivation = 'package-manager'
  }
  if (fileDerivation?.type === 'ethercat-device') {
    languageOrDerivation = 'ethercat-device'
  }
  if (fileDerivation?.type === 'library-manager') {
    languageOrDerivation = 'library-manager'
  }
  if (fileDerivation?.type === 'library-manifest') {
    languageOrDerivation = 'library-manifest'
  }
  if (fileDerivation?.type === 'diff-viewer') {
    languageOrDerivation = 'diff-viewer'
  }

  const { file: associatedFile } = getFile({ name: fileName || '' })
  const handleFileName = useCallback(
    (label: string | undefined) => unsavedLabel(label, associatedFile),
    [associatedFile],
  )

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
        <span
          className={cn(
            'flex-grow overflow-hidden text-ellipsis whitespace-nowrap',
            isUnsaved(associatedFile) && 'italic',
          )}
        >
          {handleFileName(fileName) as string}
        </span>
        <span
          aria-hidden='true'
          className={cn(currentTab ? 'bg-brand' : 'bg-transparent', 'absolute inset-x-0 top-0 z-50 h-[3px]')}
        />
      </div>
      <CloseIcon
        onClick={() => handleDeleteTab()}
        className={cn(
          'absolute right-2 z-[999] hidden h-4 w-4 rounded-sm stroke-brand p-[2px] hover:bg-neutral-300 group-hover:block dark:stroke-brand-light dark:hover:bg-neutral-700',
        )}
      />
    </div>
  )
}

export { Tab }
