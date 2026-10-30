import { memo } from 'react'

import { SectionRenderer } from './section-renderer'

type ScreenSection = {
  id: string
  title: string
  layout: string
  collapsible?: boolean
  collapsed?: boolean
  maxSlots?: number
  moduleSource?: string
  /** When true on a module-slots section, the backplane is treated as
   *  stackable: empty slots are hidden, modules are added at the end
   *  via an "Add module" button, and removal shifts following slots up. */
  stackable?: boolean
  fields?: unknown[]
  actions?: unknown[]
  persistence?: string
  /** vpp-extensions override: multiple sections sharing the same
   *  `storageId` persist into one bucket under
   *  `project.data.vppExtensions[packageId][storageId]`. */
  storageId?: string
  /** io-table / table: `device-setup` or `variable-picker` select which row source feeds the layout. */
  source?: unknown
  /** table: columns the renderer walks to lay out the grid. */
  columns?: unknown[]
  /** table: `{ field, placeholder? }` — enables the filter bar; `field` is a column id. */
  search?: unknown
  /** form / table: structured conditional-visibility clause evaluated against
   *  the shared storage bucket; a false evaluation renders the section but
   *  disables every input and reports the gate to the user. */
  enabledWhen?: unknown
  /** vendor-document: page inside the package that hosts the configurator. */
  document?: unknown
  /** vendor-document: device board name → controller type id passed to the configurator. */
  controllers?: unknown
  /** vendor-document: configurator bundle version, stored next to its archive. */
  bundleVersion?: unknown
}

type ScreenDefinition = {
  sections: ScreenSection[]
}

type ModuleDefinition = {
  id: string
  name: string
  hwId?: string
  typeId?: string
  processImage?: { inputBytes: number; outputBytes: number }
  image?: string
  description?: string
  specs?: Record<string, string>
  configScreen?: string
  /** Parsed per-module config-screen JSON, loaded by the backend
   *  alongside top-level screens. Renderers read fields from here to
   *  produce the slot-detail config form. */
  configScreenDefinition?: unknown
  io: { digitalInputs: number; digitalOutputs: number; analogInputs: number; analogOutputs: number }
  parameters?: Array<{
    id: string
    name: string
    type: string
    options?: string[]
    default?: unknown
    min?: number
    max?: number
  }>
  addressMapping?: unknown
}

type ModuleSystem = {
  enabled: boolean
  maxSlots: number
  discoverySupported?: boolean
  modules: ModuleDefinition[]
} | null

type VendorScreenRendererProps = {
  screenDefinition: unknown
  moduleSystem: ModuleSystem
}

const VendorScreenRenderer = memo(function VendorScreenRenderer({
  screenDefinition,
  moduleSystem,
}: VendorScreenRendererProps) {
  const screen = screenDefinition as ScreenDefinition
  if (!screen?.sections) return null

  return (
    // `flex-1 min-h-0` lets a child section (e.g. `module-slots`) claim
    // the full available height and host its own internal scrollers
    // instead of forcing the page-level container to scroll.
    <div className='flex min-h-0 w-full flex-1 flex-col gap-3'>
      {screen.sections.map((section) => (
        <SectionRenderer key={section.id} section={section} moduleSystem={moduleSystem} />
      ))}
    </div>
  )
})

export { VendorScreenRenderer }
export type { ModuleDefinition, ModuleSystem, ScreenDefinition, ScreenSection }
