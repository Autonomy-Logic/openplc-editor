import { ReactNode } from 'react'
import { Panel } from 'react-resizable-panels'

import { InfoPanel } from './info-panel'
import { LibraryTree } from './library-tree'
import { ProjectTree } from './project-tree'

export const SidebarPanel = (): ReactNode => {
  // const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  return (
    <Panel
      // onCollapse={() => setIsSidebarCollapsed(true)}
      // onExpand={() => setIsSidebarCollapsed(false)}
      collapsible={true}
      collapsedSize={0}
      id='sidebar'
      order={1}
      minSize={11}
      defaultSize={13}
      className='h-full border-inherit rounded-lg overflow-auto border-2 border-neutral-200 dark:border-neutral-850 bg-white dark:bg-neutral-950 '
    >
      <ProjectTree />
      <hr className='h-[1px] border-none bg-neutral-200 dark:bg-neutral-850 w-full' />
      <LibraryTree />
      <InfoPanel />
    </Panel>
  )
}
