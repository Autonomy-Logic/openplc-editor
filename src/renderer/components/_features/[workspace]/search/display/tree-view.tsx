import {
  ArrayIcon,
  ArrowIcon,
  DataTypeIcon,
  DeviceIcon,
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
import { CommentIcon } from '@root/renderer/assets/icons/interface/Comment'
import ZapIcon from '@root/renderer/assets/icons/interface/Zap'
import { HighlightedText } from '@root/renderer/components/_atoms'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, ReactNode, useCallback, useEffect, useState } from 'react'

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
          <HighlightedText
            text={label || ''}
            className={cn(
              'ml-1 truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
              isOpen && 'font-medium text-neutral-1000 dark:text-white',
            )}
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
      data: { pous, dataTypes, configuration },
    },
  } = useOpenPLCStore()
  const [branchIsOpen, setBranchIsOpen] = useState(false)
  const { BranchIcon, label } = BranchSources[branchTarget]
  const handleBranchVisibility = useCallback(() => setBranchIsOpen(!branchIsOpen), [branchIsOpen])
  const hasAssociatedPou: boolean =
    pous.some((pou) => pou.type === branchTarget) ||
    (branchTarget === 'data-type' && dataTypes.length > 0) ||
    (branchTarget === 'resource' && configuration !== null)
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
        <HighlightedText
          text={label || ''}
          className={cn(
            'ml-1 truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
            branchIsOpen && 'font-medium text-neutral-1000 dark:text-white',
          )}
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
  const hasAssociatedDataType: boolean = dataTypes.some((dataType) => dataType.derivation === nestedBranchTarget)
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
        <HighlightedText
          text={label || ''}
          className={cn(
            'ml-1 truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
            branchIsOpen && 'font-medium text-neutral-1000 dark:text-white',
          )}
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
  leafLang: 'il' | 'st' | 'fbd' | 'sfc' | 'ld' | 'arr' | 'enum' | 'str' | 'res'
  label?: string
  children?: ReactNode
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
}

const ProjectSearchTreeLeaf = ({ leafLang, label, ...res }: IProjectSearchTreeLeafProps) => {
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
        'flex w-full cursor-pointer flex-row items-center py-1 pl-[45px] hover:bg-slate-200 dark:hover:bg-neutral-850',

        name === label && 'bg-slate-50 dark:bg-neutral-900',
      )}
      onClick={handleLeafSelection}
      {...res}
    >
      <LeafIcon className='flex-shrink-0' />
      <HighlightedText
        text={label || ''}
        className={cn(
          'ml-1 w-[90%] overflow-hidden text-ellipsis whitespace-nowrap  font-caption text-xs font-medium text-neutral-1000 dark:text-white',
        )}
      />
    </li>
  )
}

const ProjectSearchTreeVariableBranch = ({ leafLang, label, children, ...res }: IProjectSearchTreeLeafProps) => {
  const {
    project: {
      data: { pous, configuration },
    },
  } = useOpenPLCStore()
  const [branchIsOpen, setBranchIsOpen] = useState<boolean>(false)
  const { LeafIcon } = LeafSources[leafLang]
  const handleBranchVisibility = useCallback(() => setBranchIsOpen(!branchIsOpen), [branchIsOpen])
  const hasVariable: boolean = pous.some((pou) => pou.data.variables.length > 0) || configuration !== null
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
        <HighlightedText
          text={label || ''}
          className={cn(
            'ml-1 truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
            branchIsOpen && 'font-medium text-neutral-1000 dark:text-white',
          )}
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
        <HighlightedText
          text={label || ''}
          className={cn(
            'ml-1 w-[90%] overflow-hidden text-ellipsis whitespace-nowrap  font-caption text-xs font-medium text-neutral-1000 dark:text-white',
          )}
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
