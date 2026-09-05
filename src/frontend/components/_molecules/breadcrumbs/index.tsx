/**
 * This need to be refactored!!!!
 */
import { startCase } from 'lodash'
import { GitBranch as SourceControlIcon } from 'lucide-react'
import { ComponentProps, useCallback, useMemo } from 'react'

import type { FbInstanceInfo } from '../../../../middleware/shared/ports'
import { ArrowIcon } from '../../../assets/icons/interface/Arrow'
import { ConfigIcon } from '../../../assets/icons/interface/Config'
import { DeviceTransferIcon } from '../../../assets/icons/interface/DeviceTransfer'
import { ArrayIcon } from '../../../assets/icons/project/Array'
import { DeviceIcon } from '../../../assets/icons/project/Device'
import { EnumIcon } from '../../../assets/icons/project/Enum'
import { GlobalVariableListIcon } from '../../../assets/icons/project/GlobalVariableList'
import { LibraryIcon } from '../../../assets/icons/project/Library'
import { LibraryManifestIcon } from '../../../assets/icons/project/LibraryManifest'
import { OrchestratorIcon } from '../../../assets/icons/project/Orchestrator'
import { PLCIcon } from '../../../assets/icons/project/PLC'
import { RemoteDeviceIcon } from '../../../assets/icons/project/RemoteDevice'
import { ServerIcon } from '../../../assets/icons/project/Server'
import { StructureIcon } from '../../../assets/icons/project/Structure'
import { UsersIcon } from '../../../assets/icons/project/Users'
import { LanguageIcon, LanguageIconType } from '../../../data/constants/language-icons'
import { PouIcon, PouIconType } from '../../../data/constants/pou-icons'
import { useOpenPLCStore } from '../../../store'

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
    editor,
    project: {
      meta: { name },
      data: { dataTypes, globalVariableLists },
    },
    workspace: { isDebuggerVisible, fbDebugInstances, fbSelectedInstance },
    workspaceActions: { setFbSelectedInstance },
  } = useOpenPLCStore()

  const { meta } = editor

  const derivationIcons = {
    enumerated: EnumIcon,
    structure: StructureIcon,
    array: ArrayIcon,
    configuration: ConfigIcon,
  }

  const getPouTypeOrDataTypeOrResource = ():
    | ['program' | 'function' | 'function-block' | 'resource' | 'data-type' | 'global-variable-list' | 'device']
    | null => {
    if ('pouType' in meta) {
      return [meta.pouType] as ['program' | 'function' | 'function-block']
    }
    if (dataTypes.find((datatype) => datatype.name === meta.name)) {
      return ['data-type']
    }
    // Before the `resource` fallback below: without this a global variable list is
    // labelled "Resource", since that branch catches everything it does not recognise.
    if (globalVariableLists?.find((list) => list.name === meta.name)) {
      return ['global-variable-list']
    }
    return ['resource']
  }

  const getIconOrLanguage = (): [React.ElementType, string] => {
    const dataTypeDerivation = dataTypes.find((datatype) => datatype.name === meta.name)?.derivation
    if (dataTypeDerivation) {
      return [derivationIcons[dataTypeDerivation], dataTypeDerivation]
    }
    // Same trap as the type fallback below: without this the list's own crumb falls
    // through to the ST icon, which is silent rather than obviously wrong.
    if (globalVariableLists?.find((list) => list.name === meta.name)) {
      return [GlobalVariableListIcon, 'global-variable-list']
    }
    if ('language' in meta) {
      return [LanguageIcon[meta.language], meta.language]
    }
    return [LanguageIcon.st, 'st']
  }

  const typeOrIcon = getPouTypeOrDataTypeOrResource()
  const [icon, text] = getIconOrLanguage()

  // Check if we should show the FB instance dropdown
  const isFunctionBlock = 'pouType' in meta && meta.pouType === 'function-block'
  const fbTypeName = meta.name
  const fbTypeKey = fbTypeName.toUpperCase()

  // Get available instances for this FB type
  const fbInstances = useMemo((): FbInstanceInfo[] => {
    if (!isFunctionBlock || !isDebuggerVisible) return []
    return fbDebugInstances.get(fbTypeKey) || []
  }, [isFunctionBlock, isDebuggerVisible, fbDebugInstances, fbTypeKey])

  // Get currently selected instance key
  const selectedInstanceKey = useMemo((): string | undefined => {
    if (!isFunctionBlock || !isDebuggerVisible) return undefined
    return fbSelectedInstance.get(fbTypeKey)
  }, [isFunctionBlock, isDebuggerVisible, fbSelectedInstance, fbTypeKey])

  // Handle instance selection change
  const handleInstanceChange = useCallback(
    (newKey: string) => {
      setFbSelectedInstance(fbTypeKey, newKey)
    },
    [fbTypeKey, setFbSelectedInstance],
  )

  // Determine if we should show the instance dropdown
  const showInstanceDropdown = isFunctionBlock && isDebuggerVisible && fbInstances.length > 0

  // Remote device and server breadcrumbs
  if (editor.type === 'plc-remote-device' || editor.type === 'plc-server') {
    const Icon = editor.type === 'plc-server' ? ServerIcon : RemoteDeviceIcon
    const category = editor.type === 'plc-server' ? 'Servers' : 'Remote Devices'
    return (
      <ol className='flex h-1/2 cursor-default select-none items-center p-2'>
        <li>
          <BreadcrumbItem Icon={PLCIcon} text={name} isLast={false} />
        </li>
        <li>
          <BreadcrumbItem Icon={Icon} text={category} isLast={false} />
        </li>
        <li>
          <BreadcrumbItem Icon={Icon} text={meta.name} isLast />
        </li>
      </ol>
    )
  }

  // Library Manifest — library projects have no Resource/POU
  // hierarchy, just the manifest at the root.  Two-segment trail:
  // <ProjectName> > Manifest.
  if (editor.type === 'plc-library-manifest') {
    return (
      <ol className='flex h-1/2 cursor-default select-none items-center p-2'>
        <li>
          <BreadcrumbItem Icon={PLCIcon} text={name} isLast={false} />
        </li>
        <li>
          <BreadcrumbItem Icon={LibraryManifestIcon} text='Manifest' isLast />
        </li>
      </ol>
    )
  }

  // EtherCAT slave device breadcrumbs
  if (editor.type === 'plc-ethercat-device') {
    return (
      <ol className='flex h-1/2 cursor-default select-none items-center p-2'>
        <li>
          <BreadcrumbItem Icon={PLCIcon} text={name} isLast={false} />
        </li>
        <li>
          <BreadcrumbItem Icon={RemoteDeviceIcon} text='Remote Devices' isLast={false} />
        </li>
        <li>
          <BreadcrumbItem Icon={RemoteDeviceIcon} text={editor.meta.busName} isLast={false} />
        </li>
        <li>
          <BreadcrumbItem Icon={RemoteDeviceIcon} text={meta.name} isLast />
        </li>
      </ol>
    )
  }

  // Device tree branch: <ProjectName> > Device > <Screen>.
  //
  // Keyed off `editor.type`, never off `meta.name`. The name match this
  // replaced recognised the single string 'Configuration', so every other
  // screen under the branch — Runtime Status, Orchestrators, Persistent
  // Storage, User Management — fell through to the `resource` fallback at the
  // foot of `getPouTypeOrDataTypeOrResource` and was labelled "Resource".
  //
  // Icons match the leaf each screen has in the project tree (`LeafSources` in
  // _molecules/project-tree), so the trail and the tree read as one thing.
  const deviceScreenIcon = (): React.ElementType | null => {
    switch (editor.type) {
      case 'plc-device':
        switch (editor.meta.derivation) {
          case 'orchestrators':
            return OrchestratorIcon
          case 'pin-mapping':
            return DeviceTransferIcon
          case 'configuration':
          case 'runtime-status':
            return ConfigIcon
        }
        break
      case 'plc-persistent-storage':
        return ConfigIcon
      case 'plc-user-management':
        return UsersIcon
    }
    return null
  }

  const DeviceScreenIcon = deviceScreenIcon()
  if (DeviceScreenIcon) {
    return (
      <ol className='flex h-1/2 cursor-default select-none items-center p-2'>
        <li>
          <BreadcrumbItem Icon={PLCIcon} text={name} isLast={false} />
        </li>
        <li>
          <BreadcrumbItem Icon={DeviceIcon} text='Device' isLast={false} />
        </li>
        <li>
          <BreadcrumbItem Icon={DeviceScreenIcon} text={meta.name} isLast />
        </li>
      </ol>
    )
  }

  // Screens that are not under any tree branch: a vendor screen sits at the
  // project root beside the Device branch, and the two managers are opened from
  // the workspace rather than the tree. Two segments, matching the manifest's
  // trail above — inventing a parent they do not have would be worse than the
  // "Resource" they used to show.
  const standaloneScreenIcon = (): React.ElementType | null => {
    switch (editor.type) {
      case 'plc-vendor-screen':
      case 'plc-package-manager':
        return ConfigIcon
      case 'plc-library-manager':
        return LibraryIcon
    }
    return null
  }

  const StandaloneScreenIcon = standaloneScreenIcon()
  if (StandaloneScreenIcon) {
    return (
      <ol className='flex h-1/2 cursor-default select-none items-center p-2'>
        <li>
          <BreadcrumbItem Icon={PLCIcon} text={name} isLast={false} />
        </li>
        <li>
          <BreadcrumbItem Icon={StandaloneScreenIcon} text={meta.name} isLast />
        </li>
      </ol>
    )
  }

  // Read-only diff tab. `meta.name` is the tab key ("Diff: <path>"), so the
  // last crumb uses the path itself.
  if (editor.type === 'diff-viewer') {
    return (
      <ol className='flex h-1/2 cursor-default select-none items-center p-2'>
        <li>
          <BreadcrumbItem Icon={PLCIcon} text={name} isLast={false} />
        </li>
        <li>
          <BreadcrumbItem Icon={SourceControlIcon} text='Source Control' isLast={false} />
        </li>
        <li>
          <BreadcrumbItem Icon={SourceControlIcon} text={editor.meta.filePath} isLast />
        </li>
      </ol>
    )
  }

  // No tab is really open yet — render nothing rather than a trail for a
  // document that does not exist.
  if (editor.type === 'available') {
    return null
  }

  return (
    <NavigationPanelBreadcrumbs
      crumb={{
        project_name: name,
        pou_to_display: {
          name: meta.name,
          type: Array.isArray(typeOrIcon) ? typeOrIcon : ['data-type'],
          language: [text as keyof LanguageIconType],
        },
      }}
      typeIcon={icon}
      showInstanceDropdown={showInstanceDropdown}
      fbInstances={fbInstances}
      selectedInstanceKey={selectedInstanceKey}
      onInstanceChange={handleInstanceChange}
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

type NavigationPanelBreadcrumbsExtendedProps = INavigationPanelBreadcrumbsProps & {
  typeIcon?: React.ElementType
  showInstanceDropdown?: boolean
  fbInstances?: FbInstanceInfo[]
  selectedInstanceKey?: string
  onInstanceChange?: (key: string) => void
}

export const NavigationPanelBreadcrumbs = ({
  crumb,
  typeIcon,
  showInstanceDropdown = false,
  fbInstances = [],
  selectedInstanceKey,
  onInstanceChange,
  ...res
}: NavigationPanelBreadcrumbsExtendedProps) => {
  const { project_name, pou_to_display } = crumb
  const { name, type, language } = pou_to_display
  const isResource = type[0] === 'resource'
  const iconToUse = typeIcon ?? LanguageIcon[language[0]] ?? LanguageIcon.st

  return (
    <ol className='flex h-1/2 cursor-default select-none items-center p-2' {...res}>
      <li>
        <BreadcrumbItem Icon={PLCIcon} text={project_name} isLast={false} />
      </li>
      <li>
        <BreadcrumbItem
          Icon={PouIcon[type[0]]}
          text={type[0] === 'global-variable-list' ? 'Global Variables' : startCase(type[0])}
          isLast={isResource}
        />
      </li>
      {!isResource && (
        <li>
          <BreadcrumbItem Icon={iconToUse} text={name} isLast={!showInstanceDropdown} />
        </li>
      )}
      {showInstanceDropdown && fbInstances.length > 0 && (
        <li className='flex items-center gap-1'>
          <select
            value={selectedInstanceKey || ''}
            onChange={(e) => onInstanceChange?.(e.target.value)}
            className='h-5 cursor-pointer rounded border border-neutral-300 bg-white px-1 font-caption text-[10px] font-medium text-neutral-850 outline-none focus:border-brand focus:ring-1 focus:ring-brand dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
            title='Select FB instance to debug'
          >
            {fbInstances.map((inst) => (
              <option key={inst.key} value={inst.key}>
                {inst.programName}.{inst.fbVariableName}
              </option>
            ))}
          </select>
        </li>
      )}
    </ol>
  )
}
