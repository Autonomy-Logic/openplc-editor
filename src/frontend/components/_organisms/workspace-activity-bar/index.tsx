import { Files, GitBranch } from 'lucide-react'
import { useCallback } from 'react'

import { useNavigation } from '../../../../middleware/shared/providers'
import { useIsNinetiesTheme } from '../../../hooks/use-nineties-theme'
import { useOpenPLCStore } from '../../../store'
import { cn } from '../../../utils/cn'
import { RetroExplorer, RetroSourceControl } from '../../_atoms/retro-icons'
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
  const editor = useOpenPLCStore(useCallback((s) => s.editor, []))
  const { closeProject } = useOpenPLCStore(useCallback((s) => s.sharedWorkspaceActions, []))
  const navigation = useNavigation()

  const isFBDEditor = editor?.type === 'plc-graphical' && editor?.meta.language === 'fbd'
  const isLadderEditor = editor?.type === 'plc-graphical' && editor?.meta.language === 'ld'
  const isNineties = useIsNinetiesTheme()

  const handleExitApplication = () => {
    const { pendingConfirmation } = closeProject()
    // When the modal opens, defer exiting to the modal's save/discard
    // path so the user's choice is respected.
    if (!pendingConfirmation) {
      navigation.exitToHost()
    }
  }
  return (
    <>
      <div className='sidebar-scroll my-5 flex min-h-0 w-full flex-1 flex-col items-center gap-5 overflow-y-auto'>
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
              {isNineties ? <RetroExplorer /> : <Files className='h-4 w-4' />}
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
              {isNineties ? <RetroSourceControl /> : <GitBranch className='h-4 w-4' />}
              {sourceControl.pendingCount > 0 && (
                <span className='absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white'>
                  {sourceControl.pendingCount > 9 ? '9+' : sourceControl.pendingCount}
                </span>
              )}
            </button>
          </TooltipSidebarWrapperButton>
        )}
        {(explorer || sourceControl) && <DividerActivityBar />}
        <div className='flex w-full flex-col items-center gap-5'>
          <DefaultWorkspaceActivityBar {...defaultActivityBar} />
        </div>
        {isFBDEditor && (
          <>
            <DividerActivityBar />
            <div className='flex w-full flex-col items-center gap-5'>
              <FBDToolbox />
            </div>
          </>
        )}
        {isLadderEditor && (
          <>
            <DividerActivityBar />
            <div className='flex w-full flex-col items-center gap-5'>
              <LadderToolbox />
            </div>
          </>
        )}
      </div>
      <div className='flex h-7 w-full shrink-0 flex-col gap-6 pb-10'>
        <TooltipSidebarWrapperButton tooltipContent='Exit'>
          <ExitButton onClick={handleExitApplication} />
        </TooltipSidebarWrapperButton>
      </div>
    </>
  )
}
