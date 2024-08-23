import { ReactNode } from 'react'

import { NavigationPanelTabs } from './tabs'

// const TestData = {
//   key: '1',
//   project_name: 'Project Name',
//   pou_to_display: {
//     name: 'Pou Name',
//     type: ['function'],
//     language: ['ld'],
//   },
// }

export const NavigationPanel = (): ReactNode => {
  return (
    <div className='h-[70px] w-full overflow-hidden rounded-lg border-2 border-neutral-200 bg-white dark:border-neutral-850 dark:bg-neutral-950'>
      <NavigationPanelTabs />
    </div>
  )
}
