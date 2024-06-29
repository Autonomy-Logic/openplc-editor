import {
  ArrayIcon,
  ArrowIcon,
  DataTypeIcon,
  DeviceIcon,
  EnumIcon,
  FBDIcon,
  FunctionBlockIcon,
  FunctionIcon,
  GenericIcon,
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
          className=' flex cursor-pointer flex-row items-center py-1 pl-2 hover:bg-slate-50 dark:hover:bg-neutral-900'
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
          <div className='pl-2'>
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

type IProjectTreeBranchProps = ComponentPropsWithoutRef<'li'> & {
  branchTarget: 'data-type' | 'function' | 'function-block' | 'program' | 'device'
  children?: ReactNode
}

const BranchSources = {
  'data-type': { BranchIcon: DataTypeIcon, label: 'Data Types' },
  function: { BranchIcon: FunctionIcon, label: 'Functions' },
  'function-block': { BranchIcon: FunctionBlockIcon, label: 'Function Blocks' },
  program: { BranchIcon: ProgramIcon, label: 'Programs' },
  device: { BranchIcon: DeviceIcon, label: 'Device' },
}
const ProjectTreeBranch = ({ branchTarget, children, ...res }: IProjectTreeBranchProps) => {
  const {
    workspace: {
      projectData: { pous, dataTypes },
    },
  } = useOpenPLCStore()
  const [branchIsOpen, setBranchIsOpen] = useState(false)
  const { BranchIcon, label } = BranchSources[branchTarget]
  const handleBranchVisibility = useCallback(() => setBranchIsOpen(!branchIsOpen), [branchIsOpen])
  const hasAssociatedPou =
    pous.some((pou) => pou.type === branchTarget) || (branchTarget === 'data-type' && dataTypes.length > 0)
  useEffect(() => setBranchIsOpen(hasAssociatedPou), [hasAssociatedPou])

  return (
    <li aria-expanded={branchIsOpen} className='cursor-pointer aria-expanded:cursor-default ' {...res}>
      <div
        className='flex w-full cursor-pointer flex-row items-center py-1 pl-2 hover:bg-slate-50 dark:hover:bg-neutral-900'
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
        <BranchIcon />
        <span
          className={cn(
            'ml-1 truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
            branchIsOpen && 'font-medium text-neutral-1000 dark:text-white',
          )}
        >
          {label}
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
  nestedBranchTarget: 'array' | 'enumerated' | 'structure'
  children?: ReactNode
}

const NestedBranchSources = {
  array: { BranchIcon: ArrayIcon, label: 'Arrays' },
  enumerated: { BranchIcon: EnumIcon, label: 'Enums' },
  structure: { BranchIcon: StructureIcon, label: 'Structures' },
}
const ProjectTreeNestedBranch = ({ nestedBranchTarget, children, ...res }: IProjectTreeNestedBranchProps) => {
  const {
    workspace: {
      projectData: { dataTypes },
    },
  } = useOpenPLCStore()
  const [branchIsOpen, setBranchIsOpen] = useState<boolean>(false)
  const { BranchIcon, label } = NestedBranchSources[nestedBranchTarget]
  const handleBranchVisibility = useCallback(() => setBranchIsOpen(!branchIsOpen), [branchIsOpen])
  const hasAssociatedDataType = dataTypes.some((dataType) => dataType.derivation.type === nestedBranchTarget)
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
          {label}
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
  nested?: boolean
  leafLang: 'il' | 'st' | 'fbd' | 'sfc' | 'ld' | 'dt' | 'res'
  label?: string
}

const LeafSources = {
  il: { LeafIcon: ILIcon },
  st: { LeafIcon: STIcon },
  fbd: { LeafIcon: FBDIcon },
  sfc: { LeafIcon: SFCIcon },
  ld: { LeafIcon: LDIcon },
  dt: { LeafIcon: GenericIcon },
  res: { LeafIcon: ResourceIcon },
}
const ProjectTreeLeaf = ({ leafLang, label, nested = false, ...res }: IProjectTreeLeafProps) => {
  const {
    editor: {
      meta: { name },
    },
  } = useOpenPLCStore()
  const [leafIsSelected, setLeafIsSelected] = useState<boolean>(false)
  const { LeafIcon } = LeafSources[leafLang]

  const handleLeafSelection = useCallback(() => setLeafIsSelected(!leafIsSelected), [leafIsSelected])

  return (
    <li
      className={cn(
        'ml-4 flex cursor-pointer flex-row items-center py-1 pl-4 hover:bg-slate-50 dark:hover:bg-neutral-900',
        nested && 'ml-8',
        name === label && 'bg-slate-50 dark:bg-neutral-900',
      )}
      onClick={handleLeafSelection}
      {...res}
    >
      <LeafIcon />
      <span
        className={cn(
          'ml-1 truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
          name === label && 'font-medium text-neutral-1000 dark:text-white',
        )}
      >
        {label}
      </span>
    </li>
  )
}
export { ProjectTreeBranch, ProjectTreeLeaf, ProjectTreeNestedBranch, ProjectTreeRoot }
