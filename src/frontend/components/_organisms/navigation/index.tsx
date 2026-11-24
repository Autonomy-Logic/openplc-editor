import { Breadcrumbs } from '../../_molecules/breadcrumbs'
import { Tabs } from '../../_molecules/tabs'

/** Id of the slot at the right of the tab bar where the active editor renders its own actions. */
export const EDITOR_ACTIONS_SLOT_ID = 'editor-tab-actions'

const Navigation = () => {
  return (
    <div className='h-[70px] w-full overflow-hidden rounded-lg border-2 border-neutral-200 bg-white dark:border-neutral-850 dark:bg-neutral-950'>
      <div className='flex items-start'>
        <div className='min-w-0 flex-1'>
          <Tabs />
        </div>
        <div id={EDITOR_ACTIONS_SLOT_ID} className='flex h-8 shrink-0 items-center gap-1 px-2' />
      </div>
      <Breadcrumbs />
    </div>
  )
}

export { Navigation }
