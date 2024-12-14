import { useOpenPLCStore } from '@root/renderer/store'
import _ from 'lodash'
import { useNavigate } from 'react-router-dom'

import { DividerActivityBar } from '../../_atoms/workspace-activity-bar/divider'
import { SaveChangesModal } from '../../_molecules/menu-bar/modals/save-changes-modal'
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
  const navigate = useNavigate()
  const {
    editor,
    modals,
    libraryActions: { clearUserLibraries },
    flowActions: { clearFlows },
    projectActions: { clearProjects },
    modalActions: { openModal },
    workspace: { editingState },
  } = useOpenPLCStore()

  //discard channges === true é pq descartei
  const isLadderEditor = editor?.type === 'plc-graphical' && editor?.meta.language === 'ld'

  const handleExitApplication = () => {
    if (editingState === 'unsaved') {
      openModal('save-changes-project', null)
      return
    }
    clearUserLibraries()
    clearFlows()
    clearProjects()
    navigate('/')
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
      {modals?.['save-changes-project']?.open === true && (
        <SaveChangesModal isOpen={modals['save-changes-project'].open} validationContext='exit' />
      )}
    </>
  )
}
