import { GitBranch } from 'lucide-react'
import { useCallback, useState } from 'react'

import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { ChangesSection } from './changes-section'
import { HistorySection } from './history-section'
import { StashSection } from './stash-section'

type SourceControlPanelProps = {
  projectId: string
}

type ActiveView = 'changes' | 'history' | 'stash'

const SourceControlPanel = ({ projectId }: SourceControlPanelProps) => {
  const [activeView, setActiveView] = useState<ActiveView>('changes')
  const pendingChangesCount = useOpenPLCStore(useCallback((s) => s.versionControl.pendingChangesCount, []))

  return (
    <div className='flex h-full w-full flex-col'>
      {/* Header */}
      <div className='shrink-0 px-2 py-2'>
        <div className='flex h-8 w-full cursor-default select-none items-center justify-start rounded-lg bg-neutral-100 px-1.5 dark:bg-brand-dark'>
          <GitBranch className='h-3.5 w-3.5 text-[#0464FB]' />
          <span className='pl-1.5 font-caption text-xs font-medium text-neutral-1000 duration-500 ease-in-out dark:text-neutral-50'>
            Source Control
          </span>
        </div>
      </div>

      {/* Tab switcher */}
      <div className='flex px-2 pb-2'>
        <button
          onClick={() => setActiveView('changes')}
          className={cn(
            'h-7 flex-1 rounded-s-md text-xs font-medium transition-colors duration-150',
            activeView === 'changes'
              ? 'bg-blue-500 text-white'
              : 'bg-neutral-100 text-neutral-500 hover:text-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200',
          )}
        >
          Changes
          {pendingChangesCount > 0 && <span className='ml-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-500' />}
        </button>
        <button
          onClick={() => setActiveView('stash')}
          className={cn(
            'h-7 flex-1 text-xs font-medium transition-colors duration-150',
            activeView === 'stash'
              ? 'bg-blue-500 text-white'
              : 'bg-neutral-100 text-neutral-500 hover:text-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200',
          )}
        >
          Stash
        </button>
        <button
          onClick={() => setActiveView('history')}
          className={cn(
            'h-7 flex-1 rounded-e-md text-xs font-medium transition-colors duration-150',
            activeView === 'history'
              ? 'bg-blue-500 text-white'
              : 'bg-neutral-100 text-neutral-500 hover:text-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200',
          )}
        >
          History
        </button>
      </div>

      {/* Content */}
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        {activeView === 'changes' && <ChangesSection projectId={projectId} />}
        {activeView === 'stash' && <StashSection projectId={projectId} />}
        {activeView === 'history' && <HistorySection projectId={projectId} />}
      </div>
    </div>
  )
}

export { SourceControlPanel }
