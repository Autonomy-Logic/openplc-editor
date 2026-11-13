/**
 * Whether a build for `boardName` needs the Arduino components the editor installs at startup. Only the OpenPLC
 * Simulator builds without them; a board missing from `halsFile` (a VPP package's board) is assumed to need them.
 */
export function buildNeedsArduinoComponents(halsFile: unknown, boardName: string): boolean {
  const entry: unknown = typeof halsFile === 'object' && halsFile !== null ? Reflect.get(halsFile, boardName) : null
  const compiler: unknown = typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'compiler') : null
  return compiler !== 'simulator'
}
