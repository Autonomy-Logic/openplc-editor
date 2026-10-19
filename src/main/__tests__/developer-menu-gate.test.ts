/**
 * The native menu's developer items are gated at BUILD time, not at runtime.
 *
 * `src/main/menu.ts` is compiled by two webpack configs whose `EnvironmentPlugin`
 * substitutes `process.env.NODE_ENV` with a literal. Written as it is, the
 * production build folds the guard away — the emitted bundle carries
 * `developerMenuItems(){return[]}` and the item cannot be added at all, which is
 * a stronger claim than "a flag was false".
 *
 * That property depends on the guard being exactly that expression. Rewriting it
 * to read a variable, a store value or an injected flag would still hide the item
 * in a normal build while leaving it present and reachable in the bundle, and
 * nothing else would notice. Hence a source guard rather than a behaviour test:
 * what is being protected IS the shape of the source.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MENU_SOURCE = readFileSync(join(__dirname, '..', 'menu.ts'), 'utf-8')

/** The body of `developerMenuItems()`, from its signature to the closing brace
 *  of the method — enough to see the guard and what follows it. */
function developerMenuItemsBody(): string {
  const start = MENU_SOURCE.indexOf('private developerMenuItems(')
  expect(start).toBeGreaterThan(-1)
  const end = MENU_SOURCE.indexOf('\n  }', start)
  expect(end).toBeGreaterThan(start)
  return MENU_SOURCE.slice(start, end)
}

describe('native developer menu', () => {
  it('returns nothing unless the build is a development build', () => {
    const body = developerMenuItemsBody()

    expect(body).toContain("if (process.env.NODE_ENV !== 'development') return []")
    // The guard has to come FIRST. Below it the items are unconditional, which
    // is what lets the production build drop them along with the guard.
    expect(body.indexOf('process.env.NODE_ENV')).toBeLessThan(body.indexOf('I/O Image Diagnostics'))
  })

  it('is the only place the native menu names a developer screen', () => {
    // A second, ungated mention would ship the entry to production while this
    // suite kept passing on the first one.
    expect(MENU_SOURCE.split('I/O Image Diagnostics').length - 1).toBe(1)
  })

  it('sends the diagnostics event rather than opening anything itself', () => {
    // The main process owns no UI: the renderer decides what the tab is, and it
    // applies its own `isDevMode` gate on top. Two independent gates.
    expect(MENU_SOURCE).toContain("this.mainWindow.webContents.send('workspace:open-diagnostics-accelerator')")
  })
})
