import { FC } from 'react'
import { HiXMark } from 'react-icons/hi2'
import ScrollContainer from 'react-indiana-drag-scroll'

import { classNames } from '@/utils'

export type TabsProps = {
  appearance?: 'primary' | 'secondary'
  tabs: {
    id: number | string
    name: string
    onClick?: () => void
    current: boolean
  }[]
}

const Tabs: FC<TabsProps> = ({ tabs, appearance = 'primary' }) => {
  if (appearance === 'primary')
    return (
      <div className="border-b border-gray-900/10 bg-white px-4 dark:border-white/5 dark:bg-gray-900">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          {tabs.map(({ id, name, current, onClick }) => (
            <button
              key={id}
              onClick={onClick}
              type="button"
              className={classNames(
                current
                  ? 'border-open-plc-blue text-open-plc-blue'
                  : 'border-transparent text-gray-500 hover:border-gray-600 hover:text-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-500',
                'whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium',
              )}
              aria-current={current ? 'page' : undefined}
            >
              {name}
            </button>
          ))}
        </nav>
      </div>
    )

  return (
    <ScrollContainer className="mx-4">
      <div className="flex items-center">
        <nav className="flex space-x-2" aria-label="Tabs">
          {tabs.map(({ id, name, current, onClick }) => (
            <div
              key={id}
              className={classNames(
                current ? 'opacity-100' : 'opacity-50 hover:opacity-100',
                'no-drag-window  flex w-32 items-center gap-2  overflow-hidden rounded-md border border-gray-700/30 bg-gray-800/30 px-3 py-2 text-sm font-medium text-white transition-all duration-300',
              )}
            >
              <span
                className={classNames(
                  current ? 'bg-open-plc-blue' : 'bg-white',
                  'h-2 w-2 rounded-full',
                )}
              />
              <button
                onClick={onClick}
                type="button"
                className="press-animated"
                aria-current={current ? 'page' : undefined}
              >
                {name}
              </button>
              <button
                onClick={onClick}
                type="button"
                className="press-animated ml-auto"
              >
                <HiXMark className="h-4 w-4 text-gray-700 transition-colors duration-300 hover:text-white" />
              </button>
            </div>
          ))}
        </nav>
      </div>
    </ScrollContainer>
  )
}

export default Tabs
