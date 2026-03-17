import { useOpenPLCStore } from '@root/renderer/store'

import { DividerActivityBar } from '../../_atoms/workspace-activity-bar/divider'
import { ExitButton } from '../../_molecules/workspace-activity-bar/default'
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
}

export const WorkspaceActivityBar = ({ defaultActivityBar }: ActivityBarProps) => {
  const {
    editor,
    sharedWorkspaceActions: { closeProject },
  } = useOpenPLCStore()

  const isFBDEditor = editor?.type === 'plc-graphical' && editor?.meta.language === 'fbd'
  const isLadderEditor = editor?.type === 'plc-graphical' && editor?.meta.language === 'ld'

  const handleExitApplication = () => {
    closeProject()
  }
  return (
    <>
      <div className='my-5 flex h-fit w-full flex-col items-center gap-10'>
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
