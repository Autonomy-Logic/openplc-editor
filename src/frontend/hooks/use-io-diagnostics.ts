/**
 * The I/O image diagnostics snapshot for the project as it stands right now.
 *
 * Reads the same four inputs a compile does and recomputes on every change to
 * them, so the panel answers "what did that checkbox move?" while the checkbox
 * is still under the cursor. The sizer is O(producers + declarations), which at
 * project scale is microseconds; the memo is there to keep the rendered tables
 * referentially stable, not because the work is expensive.
 */

import { useMemo } from 'react'

import { buildIoDiagnostics, type IoDiagnostics } from '../services/io-diagnostics'
import { useOpenPLCStore } from '../store'

export function useIoDiagnostics(): IoDiagnostics {
  const board = useOpenPLCStore((state) => state.deviceDefinitions.configuration.deviceBoard)
  const vendorScreenData = useOpenPLCStore((state) => state.deviceDefinitions.configuration.vendorScreenData)
  const pinsByBoard = useOpenPLCStore((state) => state.deviceDefinitions.pinMapping.pinsByBoard)
  const availableBoards = useOpenPLCStore((state) => state.deviceAvailableOptions.availableBoards)
  const project = useOpenPLCStore((state) => state.project.data)
  const getCompileReadyProjectData = useOpenPLCStore((state) => state.projectActions.getCompileReadyProjectData)

  return useMemo(
    () =>
      buildIoDiagnostics({
        board,
        boardInfo: availableBoards.get(board),
        // The compile-ready snapshot, not `project.data`: the sizer reads
        // literal addresses, and an alias-bound variable only becomes one here.
        projectData: getCompileReadyProjectData(),
        devicePinMapping: pinsByBoard[board] ?? [],
        ...(vendorScreenData ? { vendorScreenData } : {}),
      }),
    // `project` is a dependency the linter cannot see: the snapshot is derived
    // from it through the store action, which is what makes this recompute when
    // a declaration changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, availableBoards, project, getCompileReadyProjectData, pinsByBoard, vendorScreenData],
  )
}
