import { useMemo } from 'react'

import { projectLibraryNames } from '../../middleware/shared/utils/library/project-libraries'
import { useOpenPLCStore } from '../store'
import type { SystemLibrary } from '../store/slices/library/types'
import { projectPlcLibraries } from '../utils/stlib-to-system-library'

/** Names of the libraries the open project uses: the bundled ones, then those it lists and that are installed. */
export function useProjectLibraryNames(): string[] {
  const bundled = useOpenPLCStore((s) => s.bundledLibraryNames)
  const enabled = useOpenPLCStore((s) => s.enabledLibraries)
  return useMemo(() => projectLibraryNames(bundled, enabled), [bundled, enabled])
}

/** The open project's libraries as its PLC library tree and block pickers show them: only POUs a PLC build can use. */
export function useProjectPlcLibraries(): SystemLibrary[] {
  const system = useOpenPLCStore((s) => s.libraries.system)
  const requirements = useOpenPLCStore((s) => s.pouRequirements)
  const names = useProjectLibraryNames()
  return useMemo(() => projectPlcLibraries(system, requirements, names), [system, requirements, names])
}
