import { useState } from 'react'

import type { ModuleSystem, ScreenSection } from './index'
import { FormLayout } from './layouts/form-layout'
import { IoTableLayout } from './layouts/io-table-layout'
import { ModuleSlotsLayout } from './layouts/module-slots-layout'
import { UnsupportedLayout } from './layouts/unsupported-layout'

type SectionRendererProps = {
  section: ScreenSection
  moduleSystem: ModuleSystem
}

function SectionRenderer({ section, moduleSystem }: SectionRendererProps) {
  const [collapsed, setCollapsed] = useState(section.collapsed ?? false)

  const renderLayout = () => {
    switch (section.layout) {
      case 'module-slots':
        return <ModuleSlotsLayout section={section} moduleSystem={moduleSystem} />
      case 'io-table':
        return <IoTableLayout section={section} moduleSystem={moduleSystem} />
      case 'form':
        return <FormLayout section={section} />
      default:
        return <UnsupportedLayout layoutType={section.layout} />
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <div
        className={`flex items-center justify-between ${section.collapsible ? 'cursor-pointer' : ''}`}
        onClick={() => section.collapsible && setCollapsed(!collapsed)}
      >
        <h2 className='select-none text-lg font-medium text-neutral-950 dark:text-white'>{section.title}</h2>
        {section.collapsible && (
          <svg
            className={`h-4 w-4 text-neutral-500 transition-transform ${collapsed ? '' : 'rotate-180'}`}
            fill='none'
            viewBox='0 0 24 24'
            stroke='currentColor'
          >
            <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M19 9l-7 7-7-7' />
          </svg>
        )}
      </div>
      {!collapsed && renderLayout()}
    </div>
  )
}

export { SectionRenderer }
