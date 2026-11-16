/**
 * Which runtime a board target is, from its name and its `compiler` field.
 *
 * Runtime v3 and v4 both declare `openplc-compiler`, so the NAME is the only
 * thing that separates them — a rule the resolver and the board screen each
 * wrote out by hand, which is two chances for a target to be classified one
 * way for the build and another for the UI.
 */

/** The board name Runtime v3 ships under. */
export const RUNTIME_V3_BOARD_NAME = 'OpenPLC Runtime v3'

export interface RuntimeClassification {
  /** The `compiler` field, mirrored under the name the pipeline branches on. */
  boardRuntime: string
  isSimulator: boolean
  isRuntimeV3: boolean
  isRuntimeV4: boolean
}

export function classifyBoardRuntime(boardName: string, compiler: string | undefined): RuntimeClassification {
  const boardRuntime = compiler ?? ''
  const isRuntimeV3 = boardName === RUNTIME_V3_BOARD_NAME
  return {
    boardRuntime,
    isSimulator: boardRuntime === 'simulator',
    isRuntimeV3,
    isRuntimeV4: boardRuntime === 'openplc-compiler' && !isRuntimeV3,
  }
}
