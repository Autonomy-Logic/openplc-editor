import * as Popover from '@radix-ui/react-popover'
import {
  ArrayIcon,
  ArrowIcon,
  CloseIcon,
  ConfigIcon,
  CppIcon,
  DataTypeIcon,
  DeviceIcon,
  DeviceTransferIcon,
  EnumIcon,
  FBDIcon,
  FunctionBlockIcon,
  FunctionIcon,
  ILIcon,
  LDIcon,
  MoreOptionsIcon,
  PencilIcon,
  PLCIcon,
  ProgramIcon,
  PythonIcon,
  ResourceIcon,
  SFCIcon,
  STIcon,
  StructureIcon,
} from '@root/renderer/assets'
import { DuplicateIcon } from '@root/renderer/assets/icons/interface/Duplicate'
import { useOpenPLCStore } from '@root/renderer/store'
import { WorkspaceProjectTreeLeafType } from '@root/renderer/store/slices/workspace/types'
import { pousAllLanguages } from '@root/types/PLC/pous/language'
import { cn } from '@root/utils'
import { isUnsaved, unsavedLabel } from '@root/utils/unsaved-label'
import { ComponentPropsWithoutRef, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { toast } from '../../_features/[app]/toast/use-toast'

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
  branchTarget: 'data-type' | 'function' | 'function-block' | 'program' | 'resource' | 'device'
  children?: ReactNode
}

const BranchSources = {
  'data-type': { BranchIcon: DataTypeIcon, label: 'Data Types' },
  function: { BranchIcon: FunctionIcon, label: 'Functions' },
  'function-block': { BranchIcon: FunctionBlockIcon, label: 'Function Blocks' },
  program: { BranchIcon: ProgramIcon, label: 'Programs' },
  resource: { BranchIcon: ResourceIcon, label: 'Resource' },
  device: { BranchIcon: DeviceIcon, label: 'Device' },
}
const ProjectTreeBranch = ({ branchTarget, children, ...res }: ProjectTreeBranchProps) => {
  const {
    project: {
      data: { pous, dataTypes },
    },
    fileActions: { getFile },
  } = useOpenPLCStore()
  const [branchIsOpen, setBranchIsOpen] = useState(false)
  const { BranchIcon, label } = BranchSources[branchTarget]
  const handleBranchVisibility = useCallback(() => setBranchIsOpen(!branchIsOpen), [branchIsOpen])
  const hasAssociatedPou =
    pous.some((pou) => pou.type === branchTarget) ||
    branchTarget === 'device' ||
    (branchTarget === 'data-type' && dataTypes.length > 0)
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
  const hasAssociatedDataType = dataTypes.some((dataType) => dataType.derivation === nestedBranchTarget)
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
  leafType: WorkspaceProjectTreeLeafType
  label?: string
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
}
const ProjectTreeLeaf = ({ leafLang, leafType, label, onClick: handleLeafClick, ...res }: IProjectTreeLeafProps) => {
  const {
    editor: {
      meta: { name },
    },
    workspace: { selectedProjectTreeLeaf, isDebuggerVisible },
    workspaceActions: { setSelectedProjectTreeLeaf },
    pouActions: { deleteRequest: deletePouRequest, rename: renamePou, duplicate: duplicatePou },
    datatypeActions: { deleteRequest: deleteDatatypeRequest, rename: renameDatatype, duplicate: duplicateDatatype },
    fileActions: { getFile },
  } = useOpenPLCStore()

  const [isEditing, setIsEditing] = useState(false)
  const [newLabel, setNewLabel] = useState(label || '')
  const [isPopoverOpen, setPopoverOpen] = useState(false)

  const inputNameRef = useRef<HTMLInputElement>(null)

  const isAPou = useMemo(() => pousAllLanguages.includes(leafLang as (typeof pousAllLanguages)[number]), [leafLang])
  const isDatatype = useMemo(() => leafLang === 'arr' || leafLang === 'enum' || leafLang === 'str', [leafLang])

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

    if (!isAPou && !isDatatype) {
      toast({
        title: 'Error',
        description: 'Only POU or datatype files can be renamed.',
        variant: 'fail',
      })
      return
    }

    if (!newLabel || !label) {
      toast({
        title: 'Error',
        description: 'Pou or datatype label is required to rename.',
        variant: 'fail',
      })
      return
    }

    if (isAPou) {
      const res = await renamePou(label, newLabel)
      if (!res.success) {
        setNewLabel(label || '')
      }
      return
    }

    if (isDatatype) {
      const res = await renameDatatype(label, newLabel)
      if (!res.success) {
        setNewLabel(label || '')
      }
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
      await duplicatePou(label)
      return
    }

    if (isDatatype) {
      await duplicateDatatype(label)
      return
    }

    toast({
      title: 'Error',
      description: 'Only POU or datatype files can be duplicated.',
      variant: 'fail',
    })
  }

  const handleDeleteFile = () => {
    if (!isAPou && !isDatatype) {
      toast({
        title: 'Error',
        description: 'Only POU or datatype files can be deleted.',
        variant: 'fail',
      })
      return
    }

    if (!label) {
      toast({
        title: 'Error',
        description: 'Pou or datatype label is required to delete.',
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

    toast({
      title: 'Error',
      description: 'Only POU or datatype files can be deleted.',
      variant: 'fail',
    })
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

export { ProjectTreeBranch, ProjectTreeLeaf, ProjectTreeNestedBranch, ProjectTreeRoot }
