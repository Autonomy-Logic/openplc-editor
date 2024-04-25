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
      className='h-full overflow-auto rounded-lg border-2 border-inherit border-neutral-200 bg-white dark:border-neutral-850 dark:bg-neutral-950 '
    >
      <ProjectTree />
      <hr className='h-[1px] w-full border-none bg-neutral-200 dark:bg-neutral-850' />
      <LibraryTree />
      <InfoPanel />
    </Panel>
  )
}
