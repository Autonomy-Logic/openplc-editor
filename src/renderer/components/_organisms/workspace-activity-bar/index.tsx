import { useOpenPLCStore } from '@root/renderer/store'

import { DividerActivityBar } from '../../_atoms/workspace-activity-bar/divider'
import { ExitButton } from '../../_molecules/workspace-activity-bar/default'
import { DefaultWorkspaceActivityBar } from './default'
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
    libraryActions: { clearUserLibraries },
    flowActions: { clearFlows },
    projectActions: { clearProjects },
    modalActions: { openModal },
    workspace: { editingState },
    workspaceActions: { setEditingState },
  } = useOpenPLCStore()

  const isLadderEditor = editor?.type === 'plc-graphical' && editor?.meta.language === 'ld'

  const handleExitApplication = () => {
    if (editingState === 'unsaved') {
      openModal('save-changes-project', 'exit')
      return
    }
    setEditingState('initial-state')
    clearUserLibraries()
    clearFlows()
    clearProjects()
  }
  return (
    <>
      <div className='my-5 flex h-fit w-full flex-col items-center gap-10'>
        <DefaultWorkspaceActivityBar {...defaultActivityBar} />
        {isLadderEditor && (
          <>
            <DividerActivityBar />
            <LadderToolbox />
          </>
        )}
      </div>
      <div className='flex h-7 w-full flex-col gap-6'>
        <ExitButton onClick={handleExitApplication} />
      </div>
    </>
  )
}
