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
  isSubBranch?: boolean
  branchTarget: 'data-type' | 'function' | 'function-block' | 'program' | 'device' | 'array' | 'enum' | 'structure'
  children?: ReactNode
}

const BranchSources = {
  'data-type': { BranchIcon: DataTypeIcon, label: 'Data Types' },
  function: { BranchIcon: FunctionIcon, label: 'Functions' },
  'function-block': { BranchIcon: FunctionBlockIcon, label: 'Function Blocks' },
  program: { BranchIcon: ProgramIcon, label: 'Programs' },
  device: { BranchIcon: DeviceIcon, label: 'Device' },
  array: { BranchIcon: ArrayIcon, label: 'Arrays' },
  enum: { BranchIcon: EnumIcon, label: 'Enums' },
  structure: { BranchIcon: StructureIcon, label: 'Structures' },
}
const ProjectTreeBranch = ({ branchTarget, isSubBranch = false, children, ...res }: IProjectTreeBranchProps) => {
  const {
    projectData: { pous, dataTypes },
  } = useOpenPLCStore()
  const [branchIsOpen, setBranchIsOpen] = useState(false)
  const { BranchIcon, label } = BranchSources[branchTarget]
  const handleBranchVisibility = useCallback(() => setBranchIsOpen(!branchIsOpen), [branchIsOpen])
  const hasAssociatedPouOrDataType = pous.some((pou) => pou.type === branchTarget) || dataTypes.length > 0

  useEffect(() => setBranchIsOpen(hasAssociatedPouOrDataType), [hasAssociatedPouOrDataType])

  return (
    <li
      aria-expanded={branchIsOpen}
      className='cursor-pointer aria-expanded:cursor-default '
      {...res}
      data-branch={isSubBranch ? 'sub-branch' : 'branch'}
    >
      <div
        className='flex w-full cursor-pointer flex-row items-center py-1 pl-2 hover:bg-slate-50 dark:hover:bg-neutral-900'
        onClick={hasAssociatedPouOrDataType ? handleBranchVisibility : undefined}
      >
        {hasAssociatedPouOrDataType ? (
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
const ProjectTreeLeaf = ({ leafLang, label, ...res }: IProjectTreeLeafProps) => {
  const {
    editor: { name },
  } = useOpenPLCStore()
  const [leafIsSelected, setLeafIsSelected] = useState(false)
  const { LeafIcon } = LeafSources[leafLang]

  const handleLeafSelection = useCallback(() => setLeafIsSelected(!leafIsSelected), [leafIsSelected])

  return (
    <li
      className={cn(
        'ml-4 flex cursor-pointer flex-row items-center py-1 pl-4 hover:bg-slate-50 dark:hover:bg-neutral-900',
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
export { ProjectTreeBranch, ProjectTreeLeaf, ProjectTreeRoot }
