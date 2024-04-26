import {
  ArrowIcon,
  DataTypeIcon,
  DeviceIcon,
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
} from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, ReactNode, useCallback, useState } from 'react'

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
  branchTarget: 'dataType' | 'function' | 'functionBlock' | 'program' | 'device'
  children?: ReactNode
}

const BranchSources = {
  dataType: { BranchIcon: DataTypeIcon, label: 'Data Types' },
  function: { BranchIcon: FunctionIcon, label: 'Functions' },
  functionBlock: { BranchIcon: FunctionBlockIcon, label: 'Function Blocks' },
  program: { BranchIcon: ProgramIcon, label: 'Programs' },
  device: { BranchIcon: DeviceIcon, label: 'Device' },
}
const ProjectTreeBranch = ({ branchTarget, children, ...res }: IProjectTreeBranchProps) => {
  const {
    workspaceState: {
      projectData: { pous },
    },
  } = useOpenPLCStore()
  const [branchIsOpen, setBranchIsOpen] = useState(false)
  const handleBranchVisibility = useCallback(() => setBranchIsOpen(!branchIsOpen), [branchIsOpen])

  const { BranchIcon, label } = BranchSources[branchTarget]

  return (
    <li aria-expanded={branchIsOpen} className='cursor-pointer aria-expanded:cursor-default ' {...res}>
      <div
        className='flex w-full cursor-pointer flex-row items-center py-1 pl-2 hover:bg-slate-50 dark:hover:bg-neutral-900'
        onClick={handleBranchVisibility}
      >
        {pous?.length !== 0 ? (
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
  leafLang: 'IL' | 'ST' | 'FBD' | 'SFC' | 'LD' | 'DT' | 'RES'
  label?: string
}

const LeafSources = {
  IL: { LeafIcon: ILIcon },
  ST: { LeafIcon: STIcon },
  FBD: { LeafIcon: FBDIcon },
  SFC: { LeafIcon: SFCIcon },
  LD: { LeafIcon: LDIcon },
  DT: { LeafIcon: DataTypeIcon },
  RES: { LeafIcon: ResourceIcon },
}
const ProjectTreeLeaf = ({ leafLang, label = 'Data Type', ...res }: IProjectTreeLeafProps) => {
  const [leafIsSelected, setLeafIsSelected] = useState(false)
  const { LeafIcon } = LeafSources[leafLang]

  const handleLeafSelection = useCallback(() => setLeafIsSelected(!leafIsSelected), [leafIsSelected])

  return (
    <li
      className='ml-4 flex cursor-pointer flex-row items-center py-1 pl-4 hover:bg-slate-50 dark:hover:bg-neutral-900'
      onClick={handleLeafSelection}
      {...res}
    >
      <LeafIcon />
      <span
        className={cn(
          'ml-1 truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
          leafIsSelected && 'font-medium text-neutral-1000 dark:text-white',
        )}
      >
        {label}
      </span>
    </li>
  )
}
export { ProjectTreeBranch, ProjectTreeLeaf, ProjectTreeRoot }
