import { Breadcrumbs } from '../../_molecules/breadcrumbs'
import { Tabs } from '../../_molecules/tabs'

const Navigation = () => {
  return (
    <div className='h-[70px] w-full overflow-hidden rounded-lg border-2 border-neutral-200 bg-white dark:border-neutral-850 dark:bg-neutral-950'>
      <Tabs />
      <Breadcrumbs />
    </div>
  )
}

export { Navigation }
