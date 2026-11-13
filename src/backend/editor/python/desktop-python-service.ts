import { app } from 'electron'

import { createDesktopPython, type DesktopPython } from './desktop-python'
import { resolvePythonRuntimePaths } from './python-paths'

let python: DesktopPython | null = null

/** The editor process's Python runtime and block host, created on first use. */
export function getDesktopPython(): DesktopPython {
  python ??= createDesktopPython(
    resolvePythonRuntimePaths({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      cwd: process.cwd(),
      mainDir: __dirname,
    }),
  )
  return python
}
