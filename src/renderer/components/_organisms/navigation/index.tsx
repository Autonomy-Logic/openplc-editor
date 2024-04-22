import { Breadcrumbs } from '../../_molecules/breadcrumbs'
import { Tabs } from '../../_molecules/tabs'

const Navigation = () => {
  return (
    <div className='w-full h-[70px] overflow-hidden border-neutral-200 dark:border-neutral-850 rounded-lg bg-white dark:bg-neutral-950 border-2'>
      <Tabs />
      <Breadcrumbs />
    </div>
  )
}

export { Navigation }
