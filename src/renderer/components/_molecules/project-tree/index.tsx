import {
  ArrayIcon,
  ArrowIcon,
  CloseIcon,
  ConfigIcon,
  DataTypeIcon,
  DeviceIcon,
  DeviceTransferIcon,
  EnumIcon,
  FBDIcon,
  FunctionBlockIcon,
  FunctionIcon,
  ILIcon,
  LDIcon,
  PLCIcon,
  ProgramIcon,
  ResourceIcon,
  SFCIcon,
  STIcon,
  StructureIcon,
} from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, ReactNode, useCallback, useEffect, useState } from 'react'

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
  nestedBranchTarget: 'array' | 'enumerated' | 'structure' | 'configuration' | 'pin-mapping'
  children?: ReactNode
}

const NestedBranchSources = {
  array: { BranchIcon: ArrayIcon, label: 'Arrays' },
  enumerated: { BranchIcon: EnumIcon, label: 'Enums' },
  structure: { BranchIcon: StructureIcon, label: 'Structures' },
  configuration: { BranchIcon: ConfigIcon, label: 'Configurations' },
  'pin-mapping': { BranchIcon: DeviceTransferIcon, label: 'Pins' },
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
    modalActions: { openModal },
  } = useOpenPLCStore()

  const [leafIsSelected, setLeafIsSelected] = useState<boolean>(false)
  const { LeafIcon } = LeafSources[leafLang]

  const handleLeafSelection = useCallback(() => setLeafIsSelected(!leafIsSelected), [leafIsSelected])
  const modalData = { leafLang, label }

  const handleDeleteTab = () => {
    openModal('confirm-delete-element', modalData)
  }

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
      <span
        className={cn(
          'ml-1 w-[90%] overflow-hidden text-ellipsis whitespace-nowrap font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
          name === label && 'font-medium text-neutral-1000 dark:text-white',
        )}
        dangerouslySetInnerHTML={{ __html: label || '' }}
      />
      {leafLang === 'devPin' || leafLang === 'devConfig' ? null : (
        <button
          aria-label='delete element button'
          type='button'
          className='mr-2 flex h-5 w-5 items-center'
          onClick={(e) => {
            e.stopPropagation()
            handleDeleteTab()
          }}
          aria-haspopup='dialog'
          aria-expanded='false'
        >
          <CloseIcon className='h-4 w-4 group-hover:stroke-red-500' />
        </button>
      )}
    </li>
  )
}

export { ProjectTreeBranch, ProjectTreeLeaf, ProjectTreeNestedBranch, ProjectTreeRoot }
