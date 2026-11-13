/**
 * StandardWidgets: the HMI's ST library (element base, containers, widgets, keyboard, screen base and runtime),
 * compiled as its own STruC++ library. Its {external} code calls the C core, so consumers include `hmi_core.h`.
 */
import { CONTAINERS_ST } from './st/containers'
import { CONTROLS_ST } from './st/controls'
import { DISPLAY_ST } from './st/display'
import { ELEMENT_ST } from './st/element'
import { PRIMITIVES_ST } from './st/primitives'
import { PROCESS_ST } from './st/process'
import { SCREEN_ST } from './st/screen'
import { TYPES_ST } from './st/types'

export interface HmiLibrarySource {
  fileName: string
  source: string
}

/** Library identity; `namespace` is the C++ namespace of its code. */
export const STANDARD_WIDGETS_LIBRARY = {
  name: 'standard-widgets',
  version: '1.0.0',
  namespace: 'hmi_widgets',
  headers: ['hmi_core.h'],
} as const

/** Sources in dependency order. */
export const STANDARD_WIDGETS_SOURCES: readonly HmiLibrarySource[] = [
  { fileName: 'types.st', source: TYPES_ST },
  { fileName: 'primitives.st', source: PRIMITIVES_ST },
  { fileName: 'element.st', source: ELEMENT_ST },
  { fileName: 'containers.st', source: CONTAINERS_ST },
  { fileName: 'display.st', source: DISPLAY_ST },
  { fileName: 'controls.st', source: CONTROLS_ST },
  { fileName: 'process.st', source: PROCESS_ST },
  { fileName: 'screen.st', source: SCREEN_ST },
]
