/** UART the debugger sits on when a package declares no `defaultSerial`. */
export const FALLBACK_DEFAULT_SERIAL = 'Serial'

/** The debugger's UART: the board's declared `defaultSerial`, else `FALLBACK_DEFAULT_SERIAL`. */
export function debuggerUart(board: { defaultSerial?: string }): string {
  return board.defaultSerial ?? FALLBACK_DEFAULT_SERIAL
}
