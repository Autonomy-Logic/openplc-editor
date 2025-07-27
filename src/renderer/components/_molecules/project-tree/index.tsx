import { toast } from '@components/_features/[app]/toast/use-toast'
import * as Popover from '@radix-ui/react-popover'
import {
  ArrayIcon,
  ArrowIcon,
  CloseIcon,
  ConfigIcon,
  DataTypeIcon,
  DeviceIcon,
  DeviceTransferIcon,
  DuplicateIcon,
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
  ResourceIcon,
  SFCIcon,
  STIcon,
  StructureIcon,
} from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import React, { ComponentPropsWithoutRef, ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { duplicateDataType, duplicateGraphicalFlow, duplicatePouAndEditor, generatePOUUniqueName } from './utils'

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
  } = useOpenPLCStore()
  const [branchIsOpen, setBranchIsOpen] = useState(false)
  const { BranchIcon, label } = BranchSources[branchTarget]
  const handleBranchVisibility = useCallback(() => setBranchIsOpen(!branchIsOpen), [branchIsOpen])
  const hasAssociatedPou =
    pous.some((pou) => pou.type === branchTarget) ||
    branchTarget === 'device' ||
    (branchTarget === 'data-type' && dataTypes.length > 0)
  useEffect(() => setBranchIsOpen(hasAssociatedPou), [hasAssociatedPou])

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
          )}
          dangerouslySetInnerHTML={{ __html: label || '' }}
        />
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
          dangerouslySetInnerHTML={{ __html: label || '' }}
        />
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
  nested?: boolean
  leafLang: 'il' | 'st' | 'fbd' | 'sfc' | 'ld' | 'arr' | 'enum' | 'str' | 'res' | 'devConfig' | 'devPin'
  label?: string
}

const LeafSources = {
  il: { LeafIcon: ILIcon },
  st: { LeafIcon: STIcon },
  fbd: { LeafIcon: FBDIcon },
  sfc: { LeafIcon: SFCIcon },
  ld: { LeafIcon: LDIcon },
  arr: { LeafIcon: ArrayIcon },
  enum: { LeafIcon: EnumIcon },
  str: { LeafIcon: StructureIcon },
  res: { LeafIcon: ResourceIcon },
  devConfig: { LeafIcon: ConfigIcon },
  devPin: { LeafIcon: DeviceTransferIcon },
}
const ProjectTreeLeaf = ({ leafLang, label, ...res }: IProjectTreeLeafProps) => {
  const {
    editor: {
      meta: { name },
    },
    libraries: { user: userLibraries },
    project,
    ladderFlows,
    fbdFlows,
    editorActions: { getEditorFromEditors, addModel, setEditor, updateEditorModel, updateEditorName },
    projectActions: { createPou, updatePouName, updateDataTypeName },
    modalActions: { openModal },
    ladderFlowActions: { addLadderFlow },
    fbdFlowActions: { addFBDFlow },
    datatypeActions: { create: createDatatype },
    tabsActions: { updateTabName },
    libraryActions: { updateLibraryName, addLibrary },
  } = useOpenPLCStore()

  const isDataType = project.data.dataTypes.some((dt) => dt.name === label)
  const isPou = project.data.pous.some((pou) => pou.data.name === label)

  const [leafIsSelected, setLeafIsSelected] = useState<boolean>(false)
  const { LeafIcon } = LeafSources[leafLang]
  const [isOpen, setIsOpen] = useState(false)

  const handleLeafSelection = useCallback(() => setLeafIsSelected(!leafIsSelected), [leafIsSelected])
  const modalData = { leafLang, label }

  const [editing, setEditing] = useState(false)
  const [newName, setNewName] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleOnClick = (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    event.stopPropagation()
    setIsOpen(true)
  }

  const handleOpenRenameTab = () => {
    setEditing(true)
  }

  const handleDuplicateTab = () => {
    const allNames = [
      ...project.data.pous.map((pou) => pou.data.name),
      ...project.data.dataTypes.map((dataType) => dataType.name),
    ]

    const newName = generatePOUUniqueName(label || '', allNames)

    if (isDataType) {
      const original = project.data.dataTypes.find((dataType) => dataType.name === label)
      if (!original) return
      duplicateDataType(original, newName, createDatatype)
      return
    }

    if (isPou) {
      const originalPOU = project.data.pous.find((pou) => pou.data.name === label)
      const originalEditor = getEditorFromEditors(label || '')
      if (!originalPOU || !originalEditor) return

      duplicatePouAndEditor(originalPOU, originalEditor, newName, createPou, addModel, setEditor)
      duplicateGraphicalFlow(
        label || '',
        newName,
        originalPOU.data.language,
        ladderFlows,
        fbdFlows,
        addLadderFlow,
        addFBDFlow,
      )

      const library = userLibraries.find((library) => library.name === label)

      if (library && originalPOU.type !== 'program') addLibrary(newName, originalPOU.type)
    }
  }

  const handleDeleteTab = () => {
    openModal('confirm-delete-element', modalData)
  }

  const handleRename = (newName: string) => {
    const formattedName = newName.trim()
    if (formattedName.length < 3) {
      toast({
        title: 'Invalid name',
        description: 'The name must be at least 3 characters',
        variant: 'fail',
      })
      setNewName(label)
      return
    }

    if (!formattedName || formattedName === label) {
      setEditing(false)
      setNewName(label)
      return
    }

    if (isDataType) {
      updateEditorModel(label || '', formattedName)
      updateDataTypeName(label || '', formattedName)
    } else if (isPou) {
      updateEditorName(label || '', formattedName)
      updatePouName(label || '', formattedName)
    }

    updateLibraryName(label || '', formattedName)
    updateTabName(label || '', formattedName)
    setEditing(false)
  }

  const options = [
    {
      name: 'Rename',
      onClick: handleOpenRenameTab,
      icon: <PencilIcon color='#B4D0FE' />,
    },
    {
      name: 'Duplicate',
      onClick: handleDuplicateTab,
      icon: <DuplicateIcon />,
    },
    {
      name: 'Delete',
      onClick: handleDeleteTab,
      icon: <CloseIcon />,
    },
  ]

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
    }
  }, [editing])

  return (
    <li
      className={cn(
        ' group flex cursor-pointer flex-row items-center py-1 pl-[58px] hover:bg-slate-50 dark:hover:bg-neutral-900',
        name === label && 'bg-slate-50 dark:bg-neutral-900',
      )}
      onClick={handleLeafSelection}
      {...res}
    >
      <LeafIcon className='flex-shrink-0' />

      {editing ? (
        <input
          ref={inputRef}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename((e.target as EventTarget & HTMLInputElement).value || '')
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={(e) => handleRename(e.target.value || '')}
          className='w-full px-1 text-xs border-0 bg-transparent text-neutral-850 dark:text-neutral-300 focus:outline-none'
        />
      ) : (
        <span
          className={cn(
            'ml-1 w-[90%] overflow-hidden text-ellipsis whitespace-nowrap font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
            name === label && 'font-medium text-neutral-1000 dark:text-white',
          )}
          onDoubleClick={() => setEditing(true)}
          dangerouslySetInnerHTML={{ __html: label || '' }}
        />
      )}

      {leafLang === 'devPin' || leafLang === 'devConfig' ? null : (
        <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
          <Popover.Trigger asChild>
            <button
              type='button'
              onClick={handleOnClick}
              className='mr-2 flex h-5 w-5 items-center rounded-md focus:bg-neutral-100 dark:focus:bg-neutral-900'
            >
              <MoreOptionsIcon className='h-4 w-4' />
            </button>
          </Popover.Trigger>

          <Popover.Portal>
            <Popover.Content
              align='start'
              side='right'
              className='focus:outline-none focus-visible:outline-none z-[100]'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='box flex h-fit w-[110px] flex-col text-xs rounded-lg bg-white dark:bg-neutral-950 text-neutral-1000 dark:text-neutral-300'>
                {options.map((option) => (
                  <div
                    className='flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                    onClick={() => {
                      option.onClick()
                      setIsOpen(false)
                    }}
                  >
                    {React.cloneElement(option.icon, {
                      key: option.name,
                      className: 'h-3 w-3 stroke-brand dark:stroke-brand-light',
                    })}
                    <p>{option.name}</p>
                  </div>
                ))}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </li>
  )
}

export { ProjectTreeBranch, ProjectTreeLeaf, ProjectTreeNestedBranch, ProjectTreeRoot }