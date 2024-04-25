import { useOpenPLCStore } from '@root/renderer/store'

import Activitybar from './components/activitybar'
import { MainContent } from './components/main-content'

export default function Workspace() {
  const { path, data, projectName, createdAt } = useOpenPLCStore()
  console.log('Data loaded -> ', data, path, projectName, createdAt)
  return (
    <div className='flex h-full w-full bg-brand-dark dark:bg-neutral-950'>
      {/** Here goes the activity component */}
      <Activitybar />
      <MainContent />
    </div>
  )
}
