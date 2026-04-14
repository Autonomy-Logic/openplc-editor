import { Files, GitBranch } from 'lucide-react'
import { useCallback } from 'react'

import { openPLCStoreBase } from '../../../store'
import { cn } from '../../../utils/cn'
import { DividerActivityBar } from '../../_atoms/workspace-activity-bar/divider'
import { ExitButton } from '../../_molecules/workspace-activity-bar/default/exit'
import { TooltipSidebarWrapperButton } from '../../_molecules/workspace-activity-bar/tooltip-button'
import { DefaultWorkspaceActivityBar } from './default'
import { FBDToolbox } from './fbd-toolbox'
import { LadderToolbox } from './ladder-toolbox'

type ActivityBarProps = {
  defaultActivityBar?: {
    zoom?: {
      onClick: () => void
    }
  }
  explorer?: {
    isActive: boolean
    onClick: () => void
  }
  sourceControl?: {
    isActive: boolean
    pendingCount: number
    onClick: () => void
  }
}

export const WorkspaceActivityBar = ({ defaultActivityBar, explorer, sourceControl }: ActivityBarProps) => {
  const editor = openPLCStoreBase(useCallback((s) => s.editor, []))
  const { closeProject } = openPLCStoreBase(useCallback((s) => s.sharedWorkspaceActions, []))

  const isFBDEditor = editor?.type === 'plc-graphical' && editor?.meta.language === 'fbd'
  const isLadderEditor = editor?.type === 'plc-graphical' && editor?.meta.language === 'ld'

  const handleExitApplication = () => {
    closeProject()
  }
  return (
    <>
      <div className='my-5 flex h-fit w-full flex-col items-center gap-10'>
        {explorer && (
          <TooltipSidebarWrapperButton tooltipContent='Explorer'>
            <button
              onClick={explorer.onClick}
              className={cn(
                'relative flex h-8 w-8 items-center justify-center rounded transition-colors duration-150',
                explorer.isActive
                  ? 'bg-blue-500/20 text-blue-500 dark:text-blue-400'
                  : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800',
              )}
              aria-label='Explorer'
            >
              <Files className='h-4 w-4' />
            </button>
          </TooltipSidebarWrapperButton>
        )}
        {sourceControl && (
          <TooltipSidebarWrapperButton tooltipContent='Source Control'>
            <button
              onClick={sourceControl.onClick}
              className={cn(
                'relative flex h-8 w-8 items-center justify-center rounded transition-colors duration-150',
                sourceControl.isActive
                  ? 'bg-blue-500/20 text-blue-500 dark:text-blue-400'
                  : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800',
              )}
              aria-label='Source Control'
            >
              <GitBranch className='h-4 w-4' />
              {sourceControl.pendingCount > 0 && (
                <span className='absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white'>
                  {sourceControl.pendingCount > 9 ? '9+' : sourceControl.pendingCount}
                </span>
              )}
            </button>
          </TooltipSidebarWrapperButton>
        )}
        {(explorer || sourceControl) && <DividerActivityBar />}
        <DefaultWorkspaceActivityBar {...defaultActivityBar} />
        {isFBDEditor && (
          <>
            <DividerActivityBar />
            <FBDToolbox />
          </>
        )}
        {isLadderEditor && (
          <>
            <DividerActivityBar />
            <LadderToolbox />
          </>
        )}
      </div>
      <div className='flex h-7 w-full flex-col gap-6'>
        <TooltipSidebarWrapperButton tooltipContent='Exit'>
          <ExitButton onClick={handleExitApplication} />
        </TooltipSidebarWrapperButton>
      </div>
    </>
  )
}
