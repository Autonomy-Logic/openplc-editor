import { GitBranch } from 'lucide-react'
import { LegacyRef, useCallback, useState } from 'react'
import { ImperativePanelHandle } from 'react-resizable-panels'

import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { ResizablePanel } from '../../../_organisms/panel'
import { ChangesSection } from './changes-section'
import { HistorySection } from './history-section'

type SourceControlPanelProps = {
  collapse: LegacyRef<ImperativePanelHandle> | undefined
  defaultSize?: number
  projectId: string
}

type ActiveView = 'changes' | 'history'

const SourceControlPanel = ({ collapse, defaultSize = 16, projectId }: SourceControlPanelProps) => {
  const [activeView, setActiveView] = useState<ActiveView>('changes')
  const pendingChangesCount = useOpenPLCStore(useCallback((s) => s.versionControl.pendingChangesCount, []))

  return (
    <ResizablePanel
      ref={collapse}
      id='sourceControlPanel'
      order={1}
      collapsible={true}
      minSize={13}
      defaultSize={defaultSize}
      maxSize={80}
      className="flex h-full w-full max-w-lg flex-col overflow-auto rounded-lg border-2 border-inherit border-neutral-200 bg-white data-[panel-size='0.0']:hidden dark:border-neutral-850 dark:bg-neutral-950"
    >
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
          {activeView === 'changes' ? (
            <ChangesSection projectId={projectId} />
          ) : (
            <HistorySection projectId={projectId} />
          )}
        </div>
      </div>
    </ResizablePanel>
  )
}

export { SourceControlPanel }
