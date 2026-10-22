import { CollapsibleCard } from '@root/frontend/components/_atoms/collapsible-card'
import { isDeviceSetupIoTable } from '@root/frontend/utils/vpp/persistence-keys'
import { readVendorDocumentSection } from '@root/frontend/utils/vpp/vendor-document-section'
import { useState } from 'react'

import type { ModuleSystem, ScreenSection } from './index'
import { ConfiguratorScreen } from './layouts/configurator-screen'
import { FormLayout } from './layouts/form-layout'
import { IoTableLayout } from './layouts/io-table-layout'
import { ModuleSlotsLayout } from './layouts/module-slots-layout'

/**
 * The layouts this renderer knows how to draw. A vendor package is untrusted
 * input, so dispatch is an allowlist rather than a switch with a default: a
 * section whose layout is not here renders NOTHING — no chrome, no title, no
 * placeholder — and therefore persists nothing, because a layout the editor
 * cannot draw is one whose field semantics it also cannot honour.
 */
const SUPPORTED_LAYOUTS = new Set(['module-slots', 'io-table', 'form', 'vendor-document'])

type SectionRendererProps = {
  section: ScreenSection
  moduleSystem: ModuleSystem
}

function SectionRenderer({ section, moduleSystem }: SectionRendererProps) {
  const [collapsed, setCollapsed] = useState(section.collapsed ?? false)

  if (!SUPPORTED_LAYOUTS.has(section.layout)) return null
  if (section.layout === 'vendor-document' && !readVendorDocumentSection(section)) return null

  const renderLayout = () => {
    switch (section.layout) {
      case 'module-slots':
        return <ModuleSlotsLayout section={section} moduleSystem={moduleSystem} />
      case 'io-table':
        return <IoTableLayout section={section} moduleSystem={moduleSystem} />
      case 'form':
        return <FormLayout section={section} />
      case 'vendor-document':
        return <ConfiguratorScreen section={section} />
      default:
        return null
    }
  }

  // `form` sections render as an expandable card (S7Comm look). The
  // card owns its own header/title, so we don't render the plain <h2>
  // header path below for these.
  if (section.layout === 'form') {
    return (
      <CollapsibleCard
        title={section.title}
        defaultOpen={!(section.collapsed ?? false)}
        collapsible={section.collapsible ?? false}
      >
        {renderLayout()}
      </CollapsibleCard>
    )
  }

  // `module-slots`, the device-setup `io-table` and `vendor-document` fill the visible area; other layouts
  // are content-sized and let the page-level container scroll. An explicit min height replaces the
  // default one, which is the full content height and would make the I/O Mapping grow, not scroll.
  const sizing =
    section.layout === 'module-slots'
      ? 'min-h-0 flex-1'
      : isDeviceSetupIoTable(section)
        ? 'min-h-[360px] flex-1'
        : section.layout === 'vendor-document'
          ? 'flex-1'
          : ''

  return (
    <div className={`flex flex-col gap-3 ${sizing}`}>
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
