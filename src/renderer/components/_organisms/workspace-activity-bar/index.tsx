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
    editorActions: { clearEditor },
    flowActions: { clearFlows },
    libraryActions: { clearUserLibraries },
    modalActions: { openModal },
    projectActions: { clearProjects },
    tabsActions: { clearTabs },
    workspace: { editingState },
    workspaceActions: { setEditingState },
  } = useOpenPLCStore()

  const isLadderEditor = editor?.type === 'plc-graphical' && editor?.meta.language === 'ld'

  const handleExitApplication = () => {
    if (editingState === 'unsaved') {
      openModal('save-changes-project', 'close-project')
      return
    }
    clearEditor()
    clearTabs()
    clearUserLibraries()
    clearFlows()
    clearProjects()
    setEditingState('initial-state')
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
