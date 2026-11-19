/** The widget libraries every HMI unit is generated with, as STruC++ archives. */
import type { StlibArchive } from 'strucpp'

import { buildStandardWidgets } from '../lib/build-standard-widgets'

/** The archives of the widget libraries whose code is compiled as library units; none when they cannot be built. */
export function hmiWidgetLibraryArchives(): StlibArchive[] {
  const standard = buildStandardWidgets()
  return standard.ok ? [standard.archive] : []
}
