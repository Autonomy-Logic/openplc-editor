import { ComponentPropsWithoutRef, ReactNode, useCallback, useEffect, useState } from 'react'

import { ArrowIcon } from '../../../../../assets/icons/interface/Arrow'
import { CommentIcon } from '../../../../../assets/icons/interface/Comment'
import ZapIcon from '../../../../../assets/icons/interface/Zap'
import { ArrayIcon } from '../../../../../assets/icons/project/Array'
import { CppIcon } from '../../../../../assets/icons/project/Cpp'
import { DataTypeIcon } from '../../../../../assets/icons/project/DataType'
import { DeviceIcon } from '../../../../../assets/icons/project/Device'
import { EnumIcon } from '../../../../../assets/icons/project/Enum'
import { FBDIcon } from '../../../../../assets/icons/project/FBD'
import { FunctionIcon } from '../../../../../assets/icons/project/Function'
import { FunctionBlockIcon } from '../../../../../assets/icons/project/FunctionBlock'
import { ILIcon } from '../../../../../assets/icons/project/IL'
import { LDIcon } from '../../../../../assets/icons/project/LD'
import { PLCIcon } from '../../../../../assets/icons/project/PLC'
import { ProgramIcon } from '../../../../../assets/icons/project/Program'
import { PythonIcon } from '../../../../../assets/icons/project/Python'
import { ResourceIcon } from '../../../../../assets/icons/project/Resource'
import { SFCIcon } from '../../../../../assets/icons/project/SFC'
import { STIcon } from '../../../../../assets/icons/project/ST'
import { StructureIcon } from '../../../../../assets/icons/project/Structure'
import { useOpenPLCStore } from '../../../../../store'
import { cn } from '../../../../../utils/cn'

type IProjectSearchTreeRootProps = ComponentPropsWithoutRef<'ul'> & {
  label: string
  children: ReactNode
}

const ProjectSearchTreeRoot = ({ children, label, ...res }: IProjectSearchTreeRootProps) => {
  const [isOpen, setIsOpen] = useState(true)
  const handleVisibility = useCallback(() => setIsOpen(!isOpen), [isOpen])
  return (
    <div className='select-none'>
      <ul className='list-none p-0' {...res}>
        <li
          className=' flex cursor-pointer flex-row items-center py-1 pl-2 hover:bg-slate-200 dark:hover:bg-neutral-850'
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
            dangerouslySetInnerHTML={{ __html: label || '' }}
          />
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

type IProjectSearchTreeBranchProps = ComponentPropsWithoutRef<'li'> & {
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

const ProjectSearchTreeBranch = ({ branchTarget, children, ...res }: IProjectSearchTreeBranchProps) => {
  const {
    project: {
      data: { pous, dataTypes, configurations },
    },
  } = useOpenPLCStore()
  const [branchIsOpen, setBranchIsOpen] = useState(false)
  const { BranchIcon, label } = BranchSources[branchTarget]
  const handleBranchVisibility = useCallback(() => setBranchIsOpen(!branchIsOpen), [branchIsOpen])
  const hasAssociatedPou: boolean =
    pous.some((pou) => pou.pouType === branchTarget) ||
    (branchTarget === 'data-type' && dataTypes.length > 0) ||
    (branchTarget === 'resource' && configurations !== null)
  useEffect(() => setBranchIsOpen(hasAssociatedPou), [hasAssociatedPou])

  return (
    <li aria-expanded={branchIsOpen} className='cursor-pointer aria-expanded:cursor-default ' {...res}>
      <div
        className='flex w-full cursor-pointer flex-row items-center py-1 pl-4 hover:bg-slate-200 dark:hover:bg-neutral-850'
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

type IProjectSearchTreeNestedBranchProps = ComponentPropsWithoutRef<'li'> & {
  nestedBranchTarget: 'array' | 'enumerated' | 'structure'
  children?: ReactNode
}

const NestedBranchSources = {
  array: { BranchIcon: ArrayIcon, label: 'Arrays' },
  enumerated: { BranchIcon: EnumIcon, label: 'Enums' },
  structure: { BranchIcon: StructureIcon, label: 'Structures' },
}

const ProjectSearchTreeNestedBranch = ({
  nestedBranchTarget,
  children,
  ...res
}: IProjectSearchTreeNestedBranchProps) => {
  const {
    project: {
      data: { dataTypes },
    },
  } = useOpenPLCStore()
  const [branchIsOpen, setBranchIsOpen] = useState<boolean>(false)
  const { BranchIcon, label } = NestedBranchSources[nestedBranchTarget]
  const handleBranchVisibility = useCallback(() => setBranchIsOpen(!branchIsOpen), [branchIsOpen])
  const hasAssociatedDataType: boolean = dataTypes.some((dataType) => dataType?.derivation === nestedBranchTarget)
  useEffect(() => setBranchIsOpen(hasAssociatedDataType), [hasAssociatedDataType])

  return (
    <li aria-expanded={branchIsOpen} className='cursor-pointer aria-expanded:cursor-default ' {...res}>
      <div
        className='ml-4 flex w-full cursor-pointer flex-row items-center py-1 pl-2 hover:bg-slate-200 dark:hover:bg-neutral-850'
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

type IProjectSearchTreeLeafProps = ComponentPropsWithoutRef<'li'> & {
  nested?: boolean
  leafLang: 'il' | 'st' | 'python' | 'cpp' | 'fbd' | 'sfc' | 'ld' | 'arr' | 'enum' | 'str' | 'res'
  label?: string
  children?: ReactNode
}

const LeafSources = {
  il: { LeafIcon: ILIcon },
  st: { LeafIcon: STIcon },
  python: { LeafIcon: PythonIcon },
  cpp: { LeafIcon: CppIcon },
  fbd: { LeafIcon: FBDIcon },
  sfc: { LeafIcon: SFCIcon },
  ld: { LeafIcon: LDIcon },
  arr: { LeafIcon: ArrayIcon },
  enum: { LeafIcon: EnumIcon },
  str: { LeafIcon: StructureIcon },
  res: { LeafIcon: ResourceIcon },
}

const ProjectSearchTreeLeaf = ({ leafLang, label, ...res }: IProjectSearchTreeLeafProps) => {
  const {
    editor: {
      meta: { name },
    },
  } = useOpenPLCStore()
  const [leafIsSelected, setLeafIsSelected] = useState<boolean>(false)
  const leafSource = LeafSources[leafLang] ?? LeafSources.st
  const { LeafIcon } = leafSource

  const handleLeafSelection = useCallback(() => setLeafIsSelected(!leafIsSelected), [leafIsSelected])

  return (
    <li
      className={cn(
        'flex w-full cursor-pointer flex-row items-center py-1 pl-[45px] hover:bg-slate-200 dark:hover:bg-neutral-850',

        name === label && 'bg-slate-50 dark:bg-neutral-900',
      )}
      onClick={handleLeafSelection}
      {...res}
    >
      <LeafIcon className='flex-shrink-0' />
      <span
        className={cn(
          'ml-1 w-[90%] overflow-hidden text-ellipsis whitespace-nowrap  font-caption text-xs font-medium text-neutral-1000 dark:text-white',
        )}
        dangerouslySetInnerHTML={{ __html: label || '' }}
      />
    </li>
  )
}

const ProjectSearchTreeVariableBranch = ({ leafLang, label, children, ...res }: IProjectSearchTreeLeafProps) => {
  const {
    project: {
      data: { pous, configurations },
    },
  } = useOpenPLCStore()
  const [branchIsOpen, setBranchIsOpen] = useState<boolean>(false)
  const { LeafIcon } = LeafSources[leafLang]
  const handleBranchVisibility = useCallback(() => setBranchIsOpen(!branchIsOpen), [branchIsOpen])
  const hasVariable: boolean =
    pous.some((pou) => (pou.interface?.variables ?? []).length > 0) || configurations !== null
  useEffect(() => setBranchIsOpen(hasVariable), [hasVariable])

  return (
    <li aria-expanded={branchIsOpen} className='cursor-pointer aria-expanded:cursor-default ' {...res}>
      <div
        className='flex w-full cursor-pointer flex-row items-center py-1 pl-6 hover:bg-slate-200 dark:hover:bg-neutral-850'
        onClick={hasVariable ? handleBranchVisibility : undefined}
      >
        {hasVariable ? (
          <ArrowIcon
            direction='right'
            className={cn(
              `mr-[6px] h-4 w-4 stroke-brand-light transition-all ${branchIsOpen && 'rotate-270 stroke-brand'}`,
            )}
          />
        ) : (
          <div className='w-[22px]' />
        )}
        <LeafIcon />
        <span
          className={cn(
            'ml-1 truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
            branchIsOpen && 'font-medium text-neutral-1000 dark:text-white',
          )}
          dangerouslySetInnerHTML={{ __html: label || '' }}
        />
      </div>

      {branchIsOpen && (
        <div>
          <ul>
            <div>
              <ul className='list-none p-0'>{children}</ul>
            </div>
          </ul>
        </div>
      )}
    </li>
  )
}

type IProjectSearchTreeVariableLeafProps = ComponentPropsWithoutRef<'li'> & {
  label?: string | null
  hasVariable?: boolean
  hasComment?: boolean
}

const ProjectSearchTreeVariableLeaf = ({
  label,
  hasVariable,
  hasComment,
  ...res
}: IProjectSearchTreeVariableLeafProps) => {
  return (
    label && (
      <li
        className={cn(
          'flex w-full cursor-pointer flex-row items-center py-1 pl-[50px] hover:bg-slate-200 dark:hover:bg-neutral-850',
        )}
        {...res}
      >
        {hasVariable && <ZapIcon className='flex-shrink-0' />}
        {hasComment && <CommentIcon className='h-5 w-5 flex-shrink-0' />}
        <span
          className={cn(
            'ml-1 w-[90%] overflow-hidden text-ellipsis whitespace-nowrap  font-caption text-xs font-medium text-neutral-1000 dark:text-white',
          )}
          dangerouslySetInnerHTML={{ __html: label || '' }}
        />
      </li>
    )
  )
}

export {
  ProjectSearchTreeBranch,
  ProjectSearchTreeLeaf,
  ProjectSearchTreeNestedBranch,
  ProjectSearchTreeRoot,
  ProjectSearchTreeVariableBranch,
  ProjectSearchTreeVariableLeaf,
}
