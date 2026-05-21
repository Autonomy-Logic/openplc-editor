import * as Popover from '@radix-ui/react-popover'
import { ComponentPropsWithoutRef, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useCapabilities, useProject } from '../../../../middleware/shared/providers'
import { ArrowIcon } from '../../../assets/icons/interface/Arrow'
import { CloseIcon } from '../../../assets/icons/interface/Close'
import { ConfigIcon } from '../../../assets/icons/interface/Config'
import { DeviceTransferIcon } from '../../../assets/icons/interface/DeviceTransfer'
import { DuplicateIcon } from '../../../assets/icons/interface/Duplicate'
import { MoreOptionsIcon } from '../../../assets/icons/interface/MoreOptions'
import { PencilIcon } from '../../../assets/icons/interface/Pencil'
import { ArrayIcon } from '../../../assets/icons/project/Array'
import { CppIcon } from '../../../assets/icons/project/Cpp'
import { DataTypeIcon } from '../../../assets/icons/project/DataType'
import { DeviceIcon } from '../../../assets/icons/project/Device'
import { EnumIcon } from '../../../assets/icons/project/Enum'
import { FBDIcon } from '../../../assets/icons/project/FBD'
import { FunctionIcon } from '../../../assets/icons/project/Function'
import { FunctionBlockIcon } from '../../../assets/icons/project/FunctionBlock'
import { ILIcon } from '../../../assets/icons/project/IL'
import { LDIcon } from '../../../assets/icons/project/LD'
import { LibraryManifestIcon } from '../../../assets/icons/project/LibraryManifest'
import { OrchestratorIcon } from '../../../assets/icons/project/Orchestrator'
import { PLCIcon } from '../../../assets/icons/project/PLC'
import { ProgramIcon } from '../../../assets/icons/project/Program'
import { PythonIcon } from '../../../assets/icons/project/Python'
import { RemoteDeviceIcon } from '../../../assets/icons/project/RemoteDevice'
import { ResourceIcon } from '../../../assets/icons/project/Resource'
import { ServerIcon } from '../../../assets/icons/project/Server'
import { SFCIcon } from '../../../assets/icons/project/SFC'
import { STIcon } from '../../../assets/icons/project/ST'
import { StructureIcon } from '../../../assets/icons/project/Structure'
import { executeSaveProject } from '../../../services/save-actions'
import { useOpenPLCStore } from '../../../store'
import { WorkspaceProjectTreeLeafType } from '../../../store/slices/workspace/types'
import { cn } from '../../../utils/cn'
import { isUnsaved, unsavedLabel } from '../../../utils/unsaved-label'
import { toast } from '../../_features/[app]/toast/use-toast'

const pousAllLanguages = ['il', 'st', 'python', 'cpp', 'ld', 'sfc', 'fbd'] as const

type IProjectTreeRootProps = ComponentPropsWithoutRef<'ul'> & {
  label: string
  children: ReactNode
}
const ProjectTreeRoot = ({ children, label, ...res }: IProjectTreeRootProps) => {
  const [isOpen, setIsOpen] = useState(true)
  const handleVisibility = useCallback(() => setIsOpen(!isOpen), [isOpen])

  return (
    <div className='select-none'>
      <ul className='list-none p-0' {...res}>
        <li
          className=' flex cursor-pointer flex-row items-center py-1 pl-3 hover:bg-slate-50 dark:hover:bg-neutral-900'
          onClick={handleVisibility}
        >
          <ArrowIcon
            direction='right'
            className={cn(`mr-[6px] h-4 w-4 stroke-brand-light transition-all ${isOpen && 'rotate-270 stroke-brand'}`)}
          />
          <PLCIcon />
          <span
            className={cn(
              'ml-1 truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
              isOpen && 'font-medium text-neutral-1000 dark:text-white',
            )}
          >
            {label}
          </span>
        </li>
        {children && isOpen && (
          <div>
            <ul>
              {children && (
                <div>
                  <ul className='list-none p-0'>{children}</ul>
                </div>
              )}
            </ul>
          </div>
        )}
      </ul>
    </div>
  )
}

type ProjectTreeBranchProps = ComponentPropsWithoutRef<'li'> & {
  branchTarget:
    | 'data-type'
    | 'function'
    | 'function-block'
    | 'program'
    | 'resource'
    | 'device'
    | 'server'
    | 'remote-device'
  children?: ReactNode
}

const BranchSources = {
  'data-type': { BranchIcon: DataTypeIcon, label: 'Data Types' },
  function: { BranchIcon: FunctionIcon, label: 'Functions' },
  'function-block': { BranchIcon: FunctionBlockIcon, label: 'Function Blocks' },
  program: { BranchIcon: ProgramIcon, label: 'Programs' },
  resource: { BranchIcon: ResourceIcon, label: 'Resource' },
  device: { BranchIcon: DeviceIcon, label: 'Device' },
  server: { BranchIcon: ServerIcon, label: 'Servers' },
  'remote-device': { BranchIcon: RemoteDeviceIcon, label: 'Remote Devices' },
}
const ProjectTreeBranch = ({ branchTarget, children, ...res }: ProjectTreeBranchProps) => {
  const {
    project: {
      data: { pous, dataTypes, servers, remoteDevices },
    },
    fileActions: { getFile },
  } = useOpenPLCStore()
  const [branchIsOpen, setBranchIsOpen] = useState(false)
  const { BranchIcon, label } = BranchSources[branchTarget]
  const handleBranchVisibility = useCallback(() => setBranchIsOpen(!branchIsOpen), [branchIsOpen])
  const hasAssociatedPou =
    pous.some((pou) => pou.pouType === branchTarget) ||
    branchTarget === 'device' ||
    (branchTarget === 'data-type' && dataTypes.length > 0) ||
    (branchTarget === 'server' && servers !== undefined && servers.length > 0) ||
    (branchTarget === 'remote-device' && remoteDevices !== undefined && remoteDevices.length > 0)
  useEffect(() => setBranchIsOpen(hasAssociatedPou), [hasAssociatedPou])

  const { file: associatedFile } = getFile({ name: label || '' })
  const handleLabel = useCallback((label: string | undefined) => unsavedLabel(label, associatedFile), [associatedFile])

  return (
    <li aria-expanded={branchIsOpen} className='cursor-pointer aria-expanded:cursor-default ' {...res}>
      <div
        className='flex w-full cursor-pointer flex-row items-center gap-1 py-1 pl-[18px] hover:bg-slate-50 dark:hover:bg-neutral-900'
        onClick={hasAssociatedPou ? handleBranchVisibility : undefined}
      >
        {hasAssociatedPou ? (
          <ArrowIcon
            direction='right'
            className={cn(
              `mr-[6px] h-4 w-4 stroke-brand-light transition-all ${branchIsOpen && 'rotate-270 stroke-brand'}`,
            )}
          />
        ) : (
          <div className='w-[22px]' />
        )}
        <div className='h-5 w-5'>
          <BranchIcon size='sm' />
        </div>
        <span
          className={cn(
            'truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
            branchIsOpen && 'font-medium text-neutral-1000 dark:text-white',
            isUnsaved(associatedFile) && 'italic',
          )}
        >
          {handleLabel(label) || ''}
        </span>
      </div>

      {children && branchIsOpen && (
        <div>
          <ul>
            {children && (
              <div>
                <ul className='list-none p-0'>{children}</ul>
              </div>
            )}
          </ul>
        </div>
      )}
    </li>
  )
}

// 'ml-4',

type IProjectTreeNestedBranchProps = ComponentPropsWithoutRef<'li'> & {
  nestedBranchTarget: 'array' | 'enumerated' | 'structure' | 'configuration'
  children?: ReactNode
}

const NestedBranchSources = {
  array: { BranchIcon: ArrayIcon, label: 'Arrays' },
  enumerated: { BranchIcon: EnumIcon, label: 'Enums' },
  structure: { BranchIcon: StructureIcon, label: 'Structures' },
  configuration: { BranchIcon: ConfigIcon, label: 'Configurations' },
}
const ProjectTreeNestedBranch = ({ nestedBranchTarget, children, ...res }: IProjectTreeNestedBranchProps) => {
  const {
    project: {
      data: { dataTypes },
    },
  } = useOpenPLCStore()

  const [branchIsOpen, setBranchIsOpen] = useState<boolean>(false)
  const { BranchIcon, label } = NestedBranchSources[nestedBranchTarget]
  const handleBranchVisibility = useCallback(() => setBranchIsOpen(!branchIsOpen), [branchIsOpen])
  const hasAssociatedDataType = dataTypes.some((dataType) => dataType?.derivation === nestedBranchTarget)
  useEffect(() => setBranchIsOpen(hasAssociatedDataType), [hasAssociatedDataType])

  return (
    <li aria-expanded={branchIsOpen} className='cursor-pointer aria-expanded:cursor-default ' {...res}>
      <div
        className='ml-4 flex w-full cursor-pointer flex-row items-center py-1 pl-2 hover:bg-slate-50 dark:hover:bg-neutral-900'
        onClick={hasAssociatedDataType ? handleBranchVisibility : undefined}
      >
        {hasAssociatedDataType ? (
          <ArrowIcon
            direction='right'
            className={cn(
              `mr-[6px] h-4 w-4 stroke-brand-light transition-all ${branchIsOpen && 'rotate-270 stroke-brand'}`,
            )}
          />
        ) : (
          <div className='w-[22px]' />
        )}
        <BranchIcon />
        <span
          className={cn(
            'ml-1 truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
            branchIsOpen && 'font-medium text-neutral-1000 dark:text-white',
          )}
        >
          {label || ''}
        </span>
      </div>

      {children && branchIsOpen && (
        <div>
          <ul>
            {children && (
              <div>
                <ul className='list-none p-0'>{children}</ul>
              </div>
            )}
          </ul>
        </div>
      )}
    </li>
  )
}

type IProjectTreeExpandableLeafProps = ComponentPropsWithoutRef<'li'> & {
  leafLang: IProjectTreeLeafProps['leafLang']
  leafType: WorkspaceProjectTreeLeafType
  label?: string
  children?: ReactNode
}

const ProjectTreeExpandableLeaf = ({
  leafLang,
  leafType,
  label,
  children,
  onClick: handleLeafClick,
  ...res
}: IProjectTreeExpandableLeafProps) => {
  const {
    editor: {
      meta: { name },
    },
    workspace: { selectedProjectTreeLeaf, isDebuggerVisible },
    workspaceActions: { setSelectedProjectTreeLeaf },
    remoteDeviceActions: { deleteRequest: deleteRemoteDeviceRequest, rename: renameRemoteDevice },
    fileActions: { getFile },
  } = useOpenPLCStore()
  const projectPort = useProject()
  const capabilities = useCapabilities()
  const { hasVersionControl } = capabilities

  const [isExpanded, setIsExpanded] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [newLabel, setNewLabel] = useState(label || '')
  const [isPopoverOpen, setPopoverOpen] = useState(false)
  const inputNameRef = useRef<HTMLInputElement>(null)

  const { LeafIcon } = LeafSources[leafLang]
  const { file: associatedFile } = getFile({ name: label || '' })
  const handleLabel = useCallback((l: string | undefined) => unsavedLabel(l, associatedFile), [associatedFile])

  const handleLeafSelection = () => {
    if (!label) return
    const { label: currentLabel } = selectedProjectTreeLeaf
    if (label === currentLabel) return
    setSelectedProjectTreeLeaf({ label, type: leafType })
  }

  const handleRenameFile = async (renamed: string) => {
    setIsEditing(false)
    if (!renamed || !label) return
    if (renamed === label) return
    const res = renameRemoteDevice(label, renamed)
    if (!res.ok) {
      setNewLabel(label || '')
      return
    }
    // Only auto-persist on platforms that track per-file changes — otherwise
    // the user's first action on a fresh project triggers a full save with
    // no version-control benefit. Local editor users keep the existing
    // "save on Ctrl+S" mental model.
    if (hasVersionControl) {
      // Persist immediately so refresh doesn't show the old name (rename
      // queues the old path's deletion in `pendingDeletions`, save propagates).
      await executeSaveProject(projectPort, capabilities)
    }
  }

  const handleDeleteFile = () => {
    if (label) deleteRemoteDeviceRequest(label)
  }

  useEffect(() => {
    if (isEditing && inputNameRef.current) {
      inputNameRef.current.focus()
      inputNameRef.current.select()
    }
  }, [inputNameRef, isEditing])

  const popoverOptions = useMemo(
    () => [
      {
        name: 'Rename',
        onClick: () => setIsEditing(true),
        icon: <PencilIcon className='h-4 w-4 stroke-brand dark:stroke-brand-light' />,
      },
      {
        name: 'Delete',
        onClick: () => handleDeleteFile(),
        icon: <CloseIcon className='h-4 w-4 stroke-brand dark:stroke-brand-light' />,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [label],
  )

  return (
    <li className='cursor-default' {...res}>
      <div
        className={cn(
          'group flex cursor-pointer flex-row items-center py-1 pl-[36px] hover:bg-slate-50 dark:hover:bg-neutral-900',
          name === label && 'bg-slate-50 dark:bg-neutral-900',
        )}
      >
        <ArrowIcon
          direction='right'
          className={cn(
            'mr-[6px] h-4 w-4 flex-shrink-0 cursor-pointer stroke-brand-light transition-all',
            isExpanded && 'rotate-270 stroke-brand',
          )}
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded(!isExpanded)
          }}
        />
        <div
          className='flex flex-1 items-center overflow-hidden'
          onClick={(e) => {
            handleLeafSelection()
            if (label === name) return
            if (handleLeafClick) handleLeafClick(e as unknown as React.MouseEvent<HTMLLIElement>)
          }}
        >
          <LeafIcon className='flex-shrink-0' />
          {isEditing ? (
            <input
              ref={inputNameRef}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRenameFile(newLabel.trim() || '')
                if (e.key === 'Escape') setIsEditing(false)
              }}
              onBlur={() => void handleRenameFile(newLabel || '')}
              className='w-full border-0 bg-transparent px-1 text-xs text-neutral-850 focus:outline-none dark:text-neutral-300'
            />
          ) : (
            <span
              className={cn(
                'ml-1 w-[90%] overflow-hidden text-ellipsis whitespace-nowrap font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
                name === label && 'font-medium text-neutral-1000 dark:text-white',
                isUnsaved(associatedFile) && 'italic',
              )}
              onDoubleClick={() => !isDebuggerVisible && setIsEditing(true)}
            >
              {handleLabel(label) || ''}
            </span>
          )}
        </div>

        <Popover.Root open={isPopoverOpen && !isDebuggerVisible} onOpenChange={setPopoverOpen}>
          <Popover.Trigger
            disabled={isDebuggerVisible}
            className={cn(
              'mr-2 flex h-5 w-5 items-center justify-center rounded-md opacity-0 hover:bg-neutral-200 group-hover:opacity-100 dark:hover:bg-neutral-850',
              {
                'bg-neutral-200 opacity-100 dark:bg-neutral-850': isPopoverOpen,
                'cursor-not-allowed': isDebuggerVisible,
              },
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreOptionsIcon className='h-4 w-4' />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align='start'
              side='right'
              sideOffset={2}
              className={cn(
                'box z-[100] flex h-fit w-fit min-w-32 flex-col rounded-lg text-xs',
                'focus:outline-none focus-visible:outline-none',
                'bg-white text-neutral-1000 dark:bg-neutral-950 dark:text-neutral-300',
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {popoverOptions.map((option, index) => (
                <div
                  key={option.name}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900',
                    { 'rounded-t-lg': index === 0, 'rounded-b-lg': index === popoverOptions.length - 1 },
                  )}
                  onClick={() => {
                    option.onClick()
                    setPopoverOpen(false)
                  }}
                >
                  {option.icon}
                  <p>{option.name}</p>
                </div>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      {children && isExpanded && <ul className='list-none p-0 pl-4'>{children}</ul>}
    </li>
  )
}

type IProjectTreeLeafProps = ComponentPropsWithoutRef<'li'> & {
  leafLang:
    | 'il'
    | 'st'
    | 'python'
    | 'cpp'
    | 'fbd'
    | 'sfc'
    | 'ld'
    | 'arr'
    | 'enum'
    | 'str'
    | 'res'
    | 'devConfig'
    | 'devPin'
    | 'devOrchestrators'
    | 'server'
    | 'remoteDevice'
    | 'vendorScreen'
    | 'ethercatDevice'
    | 'libraryManifest'
  leafType: WorkspaceProjectTreeLeafType
  label?: string
  busName?: string
  deviceId?: string
}

const LeafSources = {
  il: { LeafIcon: ILIcon },
  st: { LeafIcon: STIcon },
  fbd: { LeafIcon: FBDIcon },
  sfc: { LeafIcon: SFCIcon },
  ld: { LeafIcon: LDIcon },
  python: { LeafIcon: PythonIcon },
  cpp: { LeafIcon: CppIcon },
  arr: { LeafIcon: ArrayIcon },
  enum: { LeafIcon: EnumIcon },
  str: { LeafIcon: StructureIcon },
  res: { LeafIcon: ResourceIcon },
  devConfig: { LeafIcon: ConfigIcon },
  devPin: { LeafIcon: DeviceTransferIcon },
  devOrchestrators: { LeafIcon: OrchestratorIcon },
  server: { LeafIcon: ServerIcon },
  remoteDevice: { LeafIcon: RemoteDeviceIcon },
  vendorScreen: { LeafIcon: ConfigIcon },
  ethercatDevice: { LeafIcon: DeviceTransferIcon },
  // Library manifest gets its own document-with-bookmark icon so
  // the explorer leaf, the workspace tab, and the breadcrumb all
  // render the same glyph — the manifest is the user's entry point
  // into a library project, so it earns a dedicated mark.
  libraryManifest: { LeafIcon: LibraryManifestIcon },
}
const ProjectTreeLeaf = ({
  leafLang,
  leafType,
  label,
  busName,
  deviceId,
  onClick: handleLeafClick,
  ...res
}: IProjectTreeLeafProps) => {
  const {
    editor: {
      meta: { name },
    },
    workspace: { selectedProjectTreeLeaf, isDebuggerVisible },
    workspaceActions: { setSelectedProjectTreeLeaf },
    pouActions: { deleteRequest: deletePouRequest, rename: renamePou, duplicate: duplicatePou },
    datatypeActions: { deleteRequest: deleteDatatypeRequest, rename: renameDatatype, duplicate: duplicateDatatype },
    serverActions: { deleteRequest: deleteServerRequest, rename: renameServer },
    remoteDeviceActions: { deleteRequest: deleteRemoteDeviceRequest, rename: renameRemoteDevice },
    ethercatDeviceActions: { delete: deleteEthercatDevice, rename: renameEthercatDevice },
    fileActions: { getFile },
  } = useOpenPLCStore()
  const projectPort = useProject()
  const capabilities = useCapabilities()
  const { hasVersionControl } = capabilities

  const [isEditing, setIsEditing] = useState(false)
  const [newLabel, setNewLabel] = useState(label || '')
  const [isPopoverOpen, setPopoverOpen] = useState(false)

  const inputNameRef = useRef<HTMLInputElement>(null)

  const isAPou = useMemo(() => pousAllLanguages.includes(leafLang as (typeof pousAllLanguages)[number]), [leafLang])
  const isDatatype = useMemo(() => leafLang === 'arr' || leafLang === 'enum' || leafLang === 'str', [leafLang])
  const isServer = useMemo(() => leafLang === 'server', [leafLang])
  const isRemoteDevice = useMemo(() => leafLang === 'remoteDevice', [leafLang])
  const isEthercatDevice = useMemo(() => leafLang === 'ethercatDevice', [leafLang])

  const { LeafIcon } = LeafSources[leafLang]
  const { file: associatedFile } = getFile({ name: label || '' })

  const handleLeafSelection = () => {
    if (!label) {
      toast({
        title: 'Error',
        description: 'Pou or datatype label is required to select.',
        variant: 'fail',
      })
      return
    }

    const { label: currentLabel } = selectedProjectTreeLeaf

    if (label === currentLabel) return

    setSelectedProjectTreeLeaf({ label, type: leafType })
  }

  const handleRenameFile = async (newLabel: string) => {
    setIsEditing(false)

    if (!isAPou && !isDatatype && !isServer && !isRemoteDevice && !isEthercatDevice) {
      toast({
        title: 'Error',
        description: 'Only POU, datatype, server, or remote device files can be renamed.',
        variant: 'fail',
      })
      return
    }

    if (!newLabel || !label) {
      toast({
        title: 'Error',
        description: 'Label is required to rename.',
        variant: 'fail',
      })
      return
    }

    // No-op: user blurred or hit Enter without changing anything. Skip the
    // auto-save below so we don't persist a phantom rename event.
    if (newLabel === label) return

    // Auto-save on rename only matters on platforms that track per-file
    // changes (web). Local editor users would otherwise eat a full project
    // save on every rename with no version-control payoff — so gate the
    // persist behind the capability and let the editor follow the regular
    // Ctrl+S flow.
    const persist = async () => {
      if (hasVersionControl) await executeSaveProject(projectPort, capabilities)
    }

    if (isAPou) {
      const res = renamePou(label, newLabel)
      if (!res.ok) {
        setNewLabel(label || '')
        return
      }
      // Persist immediately: rename creates a new file in S3 and removes
      // the old, plus updates the badge correctly via pendingDeletions.
      await persist()
      return
    }

    if (isDatatype) {
      const res = renameDatatype(label, newLabel)
      if (!res.ok) {
        setNewLabel(label || '')
        return
      }
      // Datatype lives inside project.json — saving rewrites it with the
      // renamed entry. No separate file deletion needed.
      await persist()
      return
    }

    if (isServer) {
      const res = renameServer(label, newLabel)
      if (!res.ok) {
        setNewLabel(label || '')
        return
      }
      await persist()
      return
    }

    if (isRemoteDevice) {
      const res = renameRemoteDevice(label, newLabel)
      if (!res.ok) {
        setNewLabel(label || '')
        return
      }
      await persist()
      return
    }

    if (isEthercatDevice && busName && deviceId) {
      const res = renameEthercatDevice(busName, deviceId, newLabel)
      if (!res.ok) {
        setNewLabel(label || '')
      }
      // Ethercat device lives inside its parent bus file — the parent will
      // be re-serialized on the next regular save. Skipping auto-save here
      // matches the existing behavior; if persistence becomes an issue,
      // we'll add it.
      return
    }
  }

  const handleDuplicateFile = async () => {
    if (!isAPou && !isDatatype) {
      toast({
        title: 'Error',
        description: 'Only POU or datatype files can be duplicated.',
        variant: 'fail',
      })
      return
    }

    if (!label) {
      toast({
        title: 'Error',
        description: 'Pou or datatype label is required to select.',
        variant: 'fail',
      })
      return
    }

    if (isAPou) {
      duplicatePou(label, `${label}_copy`)
      // Persist the new POU file to S3 immediately. Without this, the duplicate
      // exists only in editor memory and disappears on refresh — same class of
      // bug as the delete flow we fixed in delete-confirmation-modal.
      await executeSaveProject(projectPort, capabilities)
      return
    }

    if (isDatatype) {
      duplicateDatatype(label, `${label}_copy`)
      // Datatypes live inside project.json; saving the project rewrites it
      // with the new datatype included.
      await executeSaveProject(projectPort, capabilities)
      return
    }

    toast({
      title: 'Error',
      description: 'Only POU or datatype files can be duplicated.',
      variant: 'fail',
    })
  }

  const handleDeleteFile = () => {
    if (!isAPou && !isDatatype && !isServer && !isRemoteDevice && !isEthercatDevice) {
      toast({
        title: 'Error',
        description: 'Only POU, datatype, server, or remote device files can be deleted.',
        variant: 'fail',
      })
      return
    }

    if (!label) {
      toast({
        title: 'Error',
        description: 'Label is required to delete.',
        variant: 'fail',
      })
      return
    }

    if (isAPou) {
      deletePouRequest(label)
      return
    }

    if (isDatatype) {
      deleteDatatypeRequest(label)
      return
    }

    if (isServer) {
      deleteServerRequest(label)
      return
    }

    if (isRemoteDevice) {
      deleteRemoteDeviceRequest(label)
      return
    }

    if (isEthercatDevice && busName && deviceId) {
      deleteEthercatDevice(busName, deviceId)
      return
    }
  }

  const handleLabel = useCallback((label: string | undefined) => unsavedLabel(label, associatedFile), [associatedFile])
  const popoverOptions = useMemo(() => {
    return [
      {
        name: 'Rename',
        onClick: () => {
          setIsEditing(true)
        },
        icon: <PencilIcon className='h-4 w-4 stroke-brand dark:stroke-brand-light' />,
      },
      {
        name: 'Duplicate',
        onClick: () => {
          void handleDuplicateFile()
        },
        icon: <DuplicateIcon className='h-4 w-4 stroke-brand dark:stroke-brand-light' />,
      },
      {
        name: 'Delete',
        onClick: () => {
          handleDeleteFile()
        },
        icon: <CloseIcon className='h-4 w-4 stroke-brand dark:stroke-brand-light' />,
      },
    ]
  }, [handleDeleteFile, handleDuplicateFile, setIsEditing])

  useEffect(() => {
    if (isEditing && inputNameRef.current) {
      inputNameRef.current.focus()
      inputNameRef.current.select()
    }
  }, [inputNameRef, isEditing])

  return (
    <li
      className={cn(
        'group flex cursor-pointer flex-row items-center py-1 pl-[58px] hover:bg-slate-50 dark:hover:bg-neutral-900',
        name === label && 'bg-slate-50 dark:bg-neutral-900',
      )}
      onClick={(e) => {
        handleLeafSelection()
        if (label === name) return
        if (handleLeafClick) handleLeafClick(e)
      }}
      {...res}
    >
      <LeafIcon className='flex-shrink-0' />

      {isEditing ? (
        <input
          ref={inputNameRef}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleRenameFile(newLabel.trim() || '')
            if (e.key === 'Escape') setIsEditing(false)
          }}
          onBlur={(_e) => void handleRenameFile(newLabel || '')}
          className='w-full border-0 bg-transparent px-1 text-xs text-neutral-850 focus:outline-none dark:text-neutral-300'
        />
      ) : (
        <span
          className={cn(
            'ml-1 w-[90%] overflow-hidden text-ellipsis whitespace-nowrap font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
            name === label && 'font-medium text-neutral-1000 dark:text-white',
            isUnsaved(associatedFile) && 'italic',
          )}
          onDoubleClick={() => !isDebuggerVisible && setIsEditing(true)}
        >
          {handleLabel(label) || ''}
        </span>
      )}

      {leafLang === 'devPin' || leafLang === 'devConfig' ? null : (
        <Popover.Root open={isPopoverOpen && !isDebuggerVisible} onOpenChange={setPopoverOpen}>
          <Popover.Trigger
            disabled={isDebuggerVisible}
            className={cn(
              'mr-2 flex h-5 w-5 items-center justify-center rounded-md opacity-0 hover:bg-neutral-200 group-hover:opacity-100 dark:hover:bg-neutral-850',
              {
                'bg-neutral-200 opacity-100 dark:bg-neutral-850': isPopoverOpen,
                'cursor-not-allowed': isDebuggerVisible,
              },
            )}
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <MoreOptionsIcon className='h-4 w-4' />
          </Popover.Trigger>

          <Popover.Portal>
            <Popover.Content
              align='start'
              side='right'
              sideOffset={2}
              className={cn(
                'box z-[100] flex h-fit w-fit min-w-32 flex-col rounded-lg text-xs',
                'focus:outline-none focus-visible:outline-none',
                'bg-white text-neutral-1000 dark:bg-neutral-950 dark:text-neutral-300',
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {popoverOptions.map((option, index) => (
                <div
                  key={option.name}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900',
                    {
                      'rounded-t-lg': index === 0,
                      'rounded-b-lg': index === popoverOptions.length - 1,
                    },
                  )}
                  onClick={() => {
                    option.onClick()
                    setPopoverOpen(false)
                  }}
                >
                  {option.icon}
                  <p>{option.name}</p>
                </div>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </li>
  )
}

export { ProjectTreeBranch, ProjectTreeExpandableLeaf, ProjectTreeLeaf, ProjectTreeNestedBranch, ProjectTreeRoot }
