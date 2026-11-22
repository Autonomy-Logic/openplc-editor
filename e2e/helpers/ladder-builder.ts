/**
 * Builds Ladder Diagram rungs through the editor's UI, the way a user does: drag a Contact or Coil from the toolbox,
 * or a block from the Library, over the rung, onto a drop marker; name elements through their field and its
 * autocomplete; set modifiers and Execution Control through their dialogs. Every wait reads the app and fails at once
 * when it reports a failure, quoting what it shows.
 */
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { _electron as electron, type Locator, type Page } from '@playwright/test'

import { APP_FAILURE, waitForApp } from './app-console'
import { copyPreload, type EditorSession, waitForStartup } from './editor-session'
import { saveProject, shutdown } from './electron-editor'

const MAIN = join(__dirname, '..', '..', 'release', 'app', 'dist', 'main', 'main.js')

/** What the app shows when a build step failed: the app's own failures plus the ladder editor's refusals. */
export const BUILD_FAILURE = new RegExp(
  [
    APP_FAILURE.source,
    'Cannot add to a handle branch',
    'Cannot put a block with handle branches',
    'Can not add block',
    'Some changes are invalid',
    'Update this block first',
    'Failed to create variable',
  ].join('|'),
  'i',
)

const SELECT_ALL = process.platform === 'darwin' ? 'Meta+A' : 'Control+A'
const MARKERS = '.react-flow__node-placeholder, .react-flow__node-parallelPlaceholder'
const SELECTED_MARKERS = '.react-flow__node-placeholder.selected, .react-flow__node-parallelPlaceholder.selected'

/** A name given to an element when it is dropped, used by later steps to find it. */
export type Ref = string

/** Where an element is dropped: the left rail's marker, beside or below an element, or a block pin's marker. */
export type Marker = { rail: 'left' } | { right: Ref } | { left: Ref } | { below: Ref } | { handle: Ref; pin: string }

/** A toolbox element, or a block dragged from a Library folder. */
export type Element = 'contact' | 'coil' | { block: string; library: string }

export type ContactModifier = 'negated' | 'rising edge' | 'falling edge'
export type CoilModifier = ContactModifier | 'set' | 'reset'

/** Drops an element on a marker; a contact or coil is then named, and optionally given a modifier. */
export interface DropStep {
  drop: Element
  at: Marker
  as: Ref
  name?: string
  modifier?: CoilModifier
}

/** Binds a block pin's variable field to a variable (created when new) or a literal. */
export interface PinStep {
  pin: string
  of: Ref
  value: string
}

/** Turns Execution Control (EN/ENO) on through Block Properties. */
export interface ControlStep {
  executionControl: Ref
}

export type Step = DropStep | PinStep | ControlStep

/** One rung: its comment (the scenarios it covers) and the gestures that build it, in order. */
export interface RungScript {
  comment: string
  steps: readonly Step[]
}

/** One LD program and its rungs, in display order. */
export interface PouScript {
  name: string
  rungs: readonly RungScript[]
}

type Box = { x: number; y: number; width: number; height: number }

/** The bounding box of `locator`, or an error naming `what`. */
async function boxOf(locator: Locator, what: string): Promise<Box> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`${what} has no bounding box`)
  return box
}

/** The centre of a box. */
const centre = (box: Box): { x: number; y: number } => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

/** True for a value bound verbatim (a literal), false for a plain identifier, which names a variable. */
export function isLiteral(value: string): boolean {
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || /^(TRUE|FALSE)$/i.test(value)
}

/** A short text naming a marker in failure messages. */
function describeMarker(marker: Marker): string {
  if ('rail' in marker) return 'right of the left rail'
  if ('handle' in marker) return `on pin ${marker.pin} of ${marker.handle}`
  if ('below' in marker) return `below ${marker.below}`
  if ('right' in marker) return `right of ${marker.right}`
  return `left of ${marker.left}`
}

/** The project-tree leaf of `name` (shown as `* name` while unsaved). */
export function treeLeaf(page: Page, name: string): Locator {
  return page.locator('li').filter({ has: page.locator(':scope > span', { hasText: new RegExp(`^(\\* )?${name}$`) }) })
}

/** The leaf of `name` showing no unsaved mark. */
function savedLeaf(page: Page, name: string): Locator {
  return page.locator('li').filter({ has: page.locator(':scope > span', { hasText: new RegExp(`^${name}$`) }) })
}

/** Launches the built editor on an existing profile and waits until its main window is shown. */
export async function launchOn(userData: string): Promise<EditorSession> {
  copyPreload()
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  try {
    const page = await waitForStartup(app)
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('index.html'))
      win?.setSize(1600, 1000)
    })
    return { app, page }
  } catch (error) {
    await shutdown(app)
    throw error
  }
}

/**
 * Creates a PLC project named `name` in a new folder under `parent` through the start screen's New Project wizard,
 * with a Ladder Diagram base program, and returns the project folder. The native folder picker is answered with it.
 */
export async function createProject(session: EditorSession, parent: string, name: string): Promise<string> {
  const { app, page } = session
  const dir = join(parent, name)
  mkdirSync(dir, { recursive: true })
  await app.evaluate(({ dialog }, chosen) => {
    Object.assign(dialog, { showOpenDialog: async () => ({ canceled: false, filePaths: [chosen] }) })
  }, dir)
  await page.getByRole('button', { name: 'New Project' }).click()
  await page.getByRole('button', { name: 'PLC Project' }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.locator('#project-name').fill(name)
  await page.locator('#project-path').click()
  await waitForApp(page, async () => (await page.locator('#project-path').getAttribute('placeholder')) === dir, {
    timeout: 20_000,
    failure: BUILD_FAILURE,
    message: `the wizard never showed the chosen folder ${dir}`,
  })
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.locator('[aria-label="pou-language"]').click()
  await page.getByRole('option', { name: 'Ladder Diagram' }).click()
  await page.getByRole('button', { name: 'Create Project' }).click()
  await waitForApp(
    page,
    async () => existsSync(join(dir, 'project.json')) && (await treeLeaf(page, 'main').count()) > 0,
    {
      timeout: 60_000,
      failure: BUILD_FAILURE,
      message: `the editor never opened the new project ${name}`,
    },
  )
  return dir
}

/** Opens a recent project from the start screen by its name and waits for its project tree. */
export async function openRecentProject(session: EditorSession, name: string, firstPou: string): Promise<void> {
  const { page } = session
  await waitForApp(page, async () => (await page.getByText(name, { exact: true }).count()) > 0, {
    timeout: 30_000,
    failure: BUILD_FAILURE,
    message: `the start screen never listed the project ${name}`,
  })
  await page.getByText(name, { exact: true }).first().click()
  await waitForApp(page, async () => (await treeLeaf(page, firstPou).count()) > 0, {
    timeout: 60_000,
    failure: BUILD_FAILURE,
    message: `the editor never showed ${firstPou} of ${name}`,
  })
}

/** Deletes a POU through its project-tree menu and the confirmation dialog. */
export async function deletePou(session: EditorSession, name: string): Promise<void> {
  const { page } = session
  const leaf = treeLeaf(page, name).last()
  await leaf.hover()
  await leaf.locator('button').last().click()
  await page.getByText('Delete', { exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('button', { name: 'Delete', exact: true }).filter({ visible: true }).last().click()
  await waitForApp(page, async () => (await treeLeaf(page, name).count()) === 0, {
    timeout: 20_000,
    failure: BUILD_FAILURE,
    message: `the POU ${name} is still in the project tree after Delete`,
  })
}

/** Adds an LD program through the Create PLC element menu and opens it. */
export async function addLdProgram(session: EditorSession, name: string): Promise<void> {
  const { page } = session
  await page.locator('#create-plc-element-trigger').click()
  await page.locator('#create-program-trigger').click()
  const card = page.locator('#create-program-content')
  await card.locator('#pou-name').fill(name)
  await card.locator('[aria-label="pou-language"]').click()
  await page.getByRole('option', { name: 'Ladder Diagram' }).click()
  await card.getByRole('button', { name: 'Create', exact: true }).click()
  await waitForApp(page, async () => (await treeLeaf(page, name).count()) > 0, {
    timeout: 20_000,
    failure: BUILD_FAILURE,
    message: `the program ${name} never appeared in the project tree`,
  })
  await openPou(session, name, 'ld')
}

/** Opens a POU from the project tree and waits for its editor. */
export async function openPou(session: EditorSession, name: string, language: 'ld' | 'fbd'): Promise<void> {
  const { page } = session
  await treeLeaf(page, name).last().click()
  const ready =
    language === 'ld'
      ? page.locator('[aria-label="Create new rung button"]').filter({ visible: true })
      : page.locator('.react-flow__pane').filter({ visible: true })
  await waitForApp(page, async () => (await ready.count()) > 0, {
    timeout: 30_000,
    failure: BUILD_FAILURE,
    message: `the editor of ${name} never opened`,
  })
}

/** Saves the project with the Save Project accelerator and waits until `saved` holds and the POU leaves are saved. */
export async function saveAndWait(
  session: EditorSession,
  pous: readonly string[],
  saved: () => boolean,
  what: string,
): Promise<void> {
  const { app, page } = session
  await saveProject(app)
  await waitForApp(
    page,
    async () => {
      if (!saved()) return false
      for (const pou of pous) if ((await savedLeaf(page, pou).count()) === 0) return false
      return true
    },
    { timeout: 30_000, failure: BUILD_FAILURE, message: `the save never completed: ${what}` },
  )
}

/** True when the POU file holds every comment, so the save wrote the rungs built in this session. */
export function pouFileHolds(projectDir: string, pou: string, comments: readonly string[]): boolean {
  const file = join(projectDir, 'pous', 'programs', `${pou}.ld`)
  if (!existsSync(file)) return false
  const text = readFileSync(file, 'utf8')
  return comments.every((comment) => text.includes(JSON.stringify(comment)))
}

/** Copies what the editor saved (project.json, devices/, pous/, datatypes/) from `projectDir` to `target`. */
export function copySavedProject(projectDir: string, target: string): void {
  const kept = new Set(['project.json', 'devices', 'pous', 'datatypes'])
  cpSync(projectDir, target, {
    recursive: true,
    filter: (source) => {
      const path = relative(projectDir, source)
      return path === '' || kept.has(path.split(sep)[0])
    },
  })
}

/** Builds the rungs of one LD program in the open editor. Refs and variables are scoped to this program. */
export class LadderBuilder {
  private readonly ids = new Map<Ref, string>()
  private readonly variables = new Set<string>()

  constructor(private readonly page: Page) {}

  /** The visible rung containers of the open LD editor, in display order. */
  private rungs(): Locator {
    return this.page.locator('[aria-label="Rung container"]').filter({ visible: true })
  }

  /** The node id dropped as `ref`. */
  private id(ref: Ref, context: string): string {
    const found = this.ids.get(ref)
    if (found === undefined) throw new Error(`${context}: no element was dropped as ${ref}`)
    return found
  }

  /** The node `ref` inside `rung`. */
  private node(rung: Locator, ref: Ref, context: string): Locator {
    return rung.locator(`.react-flow__node[data-id="${this.id(ref, context)}"]`)
  }

  /** Builds one rung as the last rung of the program: create it, set its comment, run its steps, check its elements. */
  async buildRung(script: RungScript, context: string): Promise<void> {
    const where = `${context} [${script.comment}]`
    try {
      const rung = await this.createRung(where)
      await this.setComment(rung, script.comment, where)
      for (const step of script.steps) await this.run(rung, step, where)
      await this.checkElements(rung, script.steps, where)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith(where)) throw error
      throw new Error(`${where}: ${message}`, { cause: error })
    }
  }

  /** Clicks Create new rung and returns the new, last rung container. */
  private async createRung(context: string): Promise<Locator> {
    const before = await this.rungs().count()
    await this.page.locator('[aria-label="Create new rung button"]').filter({ visible: true }).first().click()
    await waitForApp(this.page, async () => (await this.rungs().count()) === before + 1, {
      timeout: 15_000,
      failure: BUILD_FAILURE,
      message: `${context}: Create new rung added no rung`,
    })
    const rung = this.rungs().nth(before)
    await rung.scrollIntoViewIfNeeded()
    return rung
  }

  /** Types the rung comment into the rung header's comment field and commits it. */
  private async setComment(rung: Locator, comment: string, context: string): Promise<void> {
    const field = rung.getByPlaceholder('Start typing to add a comment to this rung')
    await field.click()
    await field.fill(comment)
    await field.blur()
    await waitForApp(this.page, async () => (await field.inputValue()) === comment, {
      timeout: 10_000,
      failure: BUILD_FAILURE,
      message: `${context}: the rung comment field does not show the comment`,
    })
  }

  /** Runs one step on `rung`. */
  private async run(rung: Locator, step: Step, context: string): Promise<void> {
    if ('drop' in step) {
      await this.drop(rung, step, context)
      if (step.name !== undefined) await this.nameElement(rung, step.as, step.name, context)
      if (step.modifier !== undefined) await this.setModifier(rung, step, step.modifier, context)
      return
    }
    if ('pin' in step) return this.bindPin(rung, step, context)
    return this.turnOnExecutionControl(rung, step.executionControl, context)
  }

  /** The source to drag for `element`: a toolbox button, or the Library item found through the Library search. */
  private async source(element: Element): Promise<Locator> {
    if (element === 'contact' || element === 'coil') {
      const label = element === 'contact' ? 'Contact' : 'Coil'
      return this.page.locator(`[aria-label="${label}"]`).filter({ visible: true }).locator('div[draggable]').first()
    }
    const search = this.page.locator('#Search-File')
    if ((await search.count()) === 0) await this.page.locator('#search-container svg').first().click()
    await search.fill(element.block)
    const folder = this.page
      .locator('#library-tree-container li')
      .filter({ has: this.page.getByText(element.library, { exact: true }) })
      .first()
    return folder
      .locator('[draggable="true"]')
      .filter({ hasText: new RegExp(`^${element.block}$`) })
      .first()
  }

  /** The node type an element becomes on the rung. */
  private static nodeType(element: Element): 'contact' | 'coil' | 'block' {
    return element === 'contact' || element === 'coil' ? element : 'block'
  }

  /** The data-ids of the drop markers the rung shows, for failure messages. */
  private async markerIds(rung: Locator): Promise<string> {
    const ids = await rung.locator(MARKERS).evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id') ?? ''))
    return ids.length === 0 ? 'none' : ids.join(', ')
  }

  /** The marker locator for `marker` in `rung` while a drag shows the markers. */
  private async resolveMarker(rung: Locator, marker: Marker, context: string): Promise<Locator> {
    const prefixed = (prefix: string): Locator => rung.locator(`.react-flow__node[data-id^="${prefix}"]`)
    let candidates: Locator
    if ('rail' in marker) candidates = prefixed('placeholder_left-rail-')
    else if ('handle' in marker) {
      candidates = rung.locator(
        `.react-flow__node[data-id="placeholder_handle_${this.id(marker.handle, context)}_${marker.pin}"]`,
      )
    } else if ('below' in marker) candidates = prefixed(`parallelPlaceholder_${this.id(marker.below, context)}_`)
    else {
      const ref = 'right' in marker ? marker.right : marker.left
      const element = await boxOf(this.node(rung, ref, context), `${context}: ${ref}`)
      const sides = prefixed(`placeholder_${this.id(ref, context)}_`)
      for (const candidate of await sides.all()) {
        const box = await candidate.boundingBox()
        if (box === null) continue
        const isRight = centre(box).x > centre(element).x
        if (isRight === 'right' in marker) return candidate
      }
      throw new Error(
        `${context}: no drop marker ${describeMarker(marker)}; markers shown: ${await this.markerIds(rung)}`,
      )
    }
    if ((await candidates.count()) === 0) {
      throw new Error(
        `${context}: no drop marker ${describeMarker(marker)}; markers shown: ${await this.markerIds(rung)}`,
      )
    }
    return candidates.first()
  }

  /** True when the marker under the pointer is `target`, or a marker at the same place (the same insertion point). */
  private async isChosen(rung: Locator, target: Locator, targetBox: Box): Promise<boolean> {
    if (((await target.getAttribute('class')) ?? '').split(/\s+/).includes('selected')) return true
    for (const selected of await rung.locator(SELECTED_MARKERS).all()) {
      const box = await selected.boundingBox()
      if (box !== null && Math.abs(box.x - targetBox.x) <= 2 && Math.abs(box.y - targetBox.y) <= 2) return true
    }
    return false
  }

  /** Which marker is selected and where each marker sits, for a failed selection. */
  private async selectionReport(rung: Locator, target: Locator): Promise<string> {
    const wanted = (await target.getAttribute('data-id')) ?? ''
    const markers = await rung.locator(MARKERS).evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect()
        const mark = n.classList.contains('selected') ? '*' : ''
        return `${mark}${n.getAttribute('data-id') ?? ''}@${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`
      }),
    )
    return `the marker ${wanted} never became the selected one; markers (* selected): ${markers.join('; ')}`
  }

  /**
   * Drags the element down the toolbox column, then across into the rung at its own height (crossing no other rung,
   * whose markers would shift the layout), onto the marker (its top-left point, which the editor
   * measures the nearest marker from), waits until that marker is the selected one, drops, and records the new node.
   */
  private async drop(rung: Locator, step: DropStep, context: string): Promise<void> {
    const where = `${context} ${step.as} ${describeMarker(step.at)}`
    const type = LadderBuilder.nodeType(step.drop)
    const existing = await rung
      .locator(`.react-flow__node-${type}`)
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id') ?? ''))
    const source = await this.source(step.drop)
    await source.scrollIntoViewIfNeeded()
    const from = centre(await boxOf(source, `${where}: the drag source`))
    await rung.scrollIntoViewIfNeeded()
    const body = await boxOf(rung.locator('[aria-label="Rung body"]'), `${where}: the rung body`)
    const via = centre(body)
    const mouse = this.page.mouse
    await mouse.move(from.x, from.y)
    await mouse.down()
    await mouse.move(from.x + 10, from.y + 10, { steps: 4 })
    await mouse.move(from.x + 10, via.y, { steps: 10 })
    await mouse.move(body.x + 40, via.y, { steps: 10 })
    await mouse.move(via.x, via.y, { steps: 10 })
    try {
      await waitForApp(this.page, async () => (await rung.locator(MARKERS).count()) > 0, {
        timeout: 10_000,
        failure: BUILD_FAILURE,
        message: `${where}: no drop markers appeared while dragging over the rung`,
      })
      const target = await this.resolveMarker(rung, step.at, where)
      await target.scrollIntoViewIfNeeded()
      const box = await boxOf(target, `${where}: the drop marker`)
      const point = { x: box.x + 1, y: box.y + 1 }
      if ('below' in step.at || 'handle' in step.at) await mouse.move(point.x, point.y - 20, { steps: 6 })
      await mouse.move(point.x, point.y, { steps: 8 })
      const nudge = { step: 0 }
      const settle = async (): Promise<boolean> => {
        nudge.step += 1
        await mouse.move(point.x + (nudge.step % 2), point.y + (nudge.step % 3 === 0 ? 1 : 0))
        return this.isChosen(rung, target, box)
      }
      await waitForApp(this.page, settle, {
        timeout: 5_000,
        intervals: [100],
        failure: BUILD_FAILURE,
        message: `${where}: the marker under the pointer never became the selected one`,
      }).catch(async (error: unknown) => {
        throw new Error(`${where}: ${await this.selectionReport(rung, target)}`, { cause: error })
      })
    } catch (error) {
      await mouse.move(from.x, from.y, { steps: 10 })
      await mouse.up()
      throw error
    }
    await mouse.up()
    const added = rung.locator(`.react-flow__node-${type}`)
    const placed: { id?: string } = {}
    await waitForApp(
      this.page,
      async () => {
        const now = await added.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id') ?? ''))
        placed.id = now.find((id) => id !== '' && !existing.includes(id))
        return placed.id !== undefined
      },
      {
        timeout: 10_000,
        failure: BUILD_FAILURE,
        message: `${where}: the ${type} was not placed (no new [data-id] node)`,
      },
    )
    if (placed.id === undefined) throw new Error(`${where}: the ${type} was not placed`)
    this.ids.set(step.as, placed.id)
  }

  /**
   * Types `value` into `field`; a literal is committed with Enter, a variable through the autocomplete: the existing
   * variable when this program already has it, otherwise Add variable.
   */
  private async fill(field: Locator, value: string, context: string): Promise<void> {
    await field.click()
    await this.page.keyboard.press(SELECT_ALL)
    await this.page.keyboard.type(value, { delay: 5 })
    if (isLiteral(value)) {
      await this.page.keyboard.press('Enter')
    } else {
      const popper = this.page.locator('[data-radix-popper-content-wrapper]').filter({ visible: true })
      const known = this.variables.has(value.toLowerCase())
      const choice = known
        ? popper.getByText(value, { exact: true })
        : popper.getByText('Add variable', { exact: true })
      await waitForApp(this.page, async () => (await choice.count()) > 0, {
        timeout: 10_000,
        failure: BUILD_FAILURE,
        message: `${context}: the autocomplete never offered ${known ? value : 'Add variable'}`,
      })
      await choice.first().click()
      this.variables.add(value.toLowerCase())
      await this.page.keyboard.press('Escape')
    }
    await waitForApp(this.page, async () => (await field.inputValue()) === value, {
      timeout: 10_000,
      failure: BUILD_FAILURE,
      message: `${context}: the field does not show ${value}`,
    })
  }

  /** Names a dropped contact or coil through its variable field. */
  private async nameElement(rung: Locator, ref: Ref, name: string, context: string): Promise<void> {
    await this.fill(this.node(rung, ref, context).locator('textarea').first(), name, `${context} ${ref}`)
  }

  /**
   * The variable field of a block pin: the variable node beside the block whose centre is level with the pin's label,
   * on the label's side of the block.
   */
  private async pinField(rung: Locator, blockRef: Ref, pin: string, context: string): Promise<Locator> {
    const block = this.node(rung, blockRef, context)
    const blockBox = await boxOf(block, `${context}: ${blockRef}`)
    const label = block.getByText(pin, { exact: true }).first()
    if ((await label.count()) === 0) throw new Error(`${context}: ${blockRef} shows no pin ${pin}`)
    const labelCentre = centre(await boxOf(label, `${context}: pin label ${pin}`))
    const isInput = labelCentre.x < centre(blockBox).x
    let best: { field: Locator; distance: number } | undefined
    for (const variable of await rung.locator('.react-flow__node-variable').all()) {
      const box = await variable.boundingBox()
      if (box === null) continue
      const beside = isInput
        ? Math.abs(box.x + box.width - blockBox.x) <= 30
        : Math.abs(box.x - (blockBox.x + blockBox.width)) <= 30
      if (!beside) continue
      const distance = Math.abs(centre(box).y - labelCentre.y)
      if (best === undefined || distance < best.distance) {
        best = { field: variable.locator('textarea').first(), distance }
      }
    }
    if (best === undefined || best.distance > 12) {
      throw new Error(`${context}: no variable field beside pin ${pin} of ${blockRef}`)
    }
    return best.field
  }

  /** Binds a block pin's variable field. */
  private async bindPin(rung: Locator, step: PinStep, context: string): Promise<void> {
    const where = `${context} ${step.of}.${step.pin}`
    await this.fill(await this.pinField(rung, step.of, step.pin, where), step.value, where)
  }

  /** Sets a contact or coil modifier through the Edit Contact/Coil Values dialog. */
  private async setModifier(rung: Locator, step: DropStep, modifier: CoilModifier, context: string): Promise<void> {
    const where = `${context} ${step.as} modifier ${modifier}`
    const title = step.drop === 'contact' ? 'Edit Contact Values' : 'Edit Coil Values'
    await this.node(rung, step.as, where).locator('svg').first().dblclick()
    const dialog = this.page.getByRole('dialog').filter({ hasText: title })
    await waitForApp(this.page, async () => (await dialog.count()) > 0, {
      timeout: 10_000,
      failure: BUILD_FAILURE,
      message: `${where}: ${title} never opened`,
    })
    await dialog
      .locator('li')
      .filter({ hasText: new RegExp(`^${modifier}$`, 'i') })
      .click()
    await dialog.getByRole('button', { name: 'Confirm' }).click()
    await waitForApp(this.page, async () => (await dialog.count()) === 0, {
      timeout: 10_000,
      failure: BUILD_FAILURE,
      message: `${where}: ${title} did not close after Confirm`,
    })
  }

  /** Opens Block Properties of a block by double-clicking it. */
  private async openBlockProperties(rung: Locator, ref: Ref, context: string): Promise<Locator> {
    await this.node(rung, ref, context).locator('button').first().dblclick()
    const dialog = this.page.getByRole('dialog').filter({ hasText: 'Block Properties' })
    await waitForApp(this.page, async () => (await dialog.count()) > 0, {
      timeout: 10_000,
      failure: BUILD_FAILURE,
      message: `${context}: Block Properties never opened for ${ref}`,
    })
    return dialog
  }

  /** The data-ids of the blocks on the rung. */
  private async blockIds(rung: Locator): Promise<string[]> {
    return rung
      .locator('.react-flow__node-block')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id') ?? ''))
  }

  /**
   * Turns Execution Control on in Block Properties and waits for the EN pin. The dialog rebuilds the block, so `ref`
   * is moved to the block's new id when the old one is gone.
   */
  private async turnOnExecutionControl(rung: Locator, ref: Ref, context: string): Promise<void> {
    const where = `${context} ${ref} Execution Control`
    const previous = this.id(ref, where)
    const before = await this.blockIds(rung)
    const dialog = await this.openBlockProperties(rung, ref, where)
    const toggle = dialog.getByRole('switch')
    await toggle.click()
    await waitForApp(this.page, async () => (await toggle.getAttribute('data-state')) === 'checked', {
      timeout: 5_000,
      failure: BUILD_FAILURE,
      message: `${where}: the switch did not turn on`,
    })
    await dialog.getByRole('button', { name: 'Ok', exact: true }).click()
    const rebuilt: { id?: string } = {}
    await waitForApp(
      this.page,
      async () => {
        if ((await dialog.count()) > 0) return false
        const now = await this.blockIds(rung)
        const added = now.filter((id) => !before.includes(id))
        rebuilt.id = now.includes(previous) ? previous : added.length === 1 ? added[0] : undefined
        return rebuilt.id !== undefined
      },
      { timeout: 10_000, failure: BUILD_FAILURE, message: `${where}: the block was not found after Ok` },
    )
    if (rebuilt.id === undefined) throw new Error(`${where}: the block was not found after Ok`)
    this.ids.set(ref, rebuilt.id)
    await waitForApp(
      this.page,
      async () => (await this.node(rung, ref, where).getByText('EN', { exact: true }).count()) > 0,
      { timeout: 10_000, failure: BUILD_FAILURE, message: `${where}: the block shows no EN pin after Ok` },
    )
  }

  /** Checks that the rung holds exactly the contacts, coils and blocks its steps dropped. */
  private async checkElements(rung: Locator, steps: readonly Step[], context: string): Promise<void> {
    const wanted = { contact: 0, coil: 0, block: 0 }
    for (const step of steps) if ('drop' in step) wanted[LadderBuilder.nodeType(step.drop)] += 1
    const count = async (type: string): Promise<number> => rung.locator(`.react-flow__node-${type}`).count()
    let shown = ''
    await waitForApp(
      this.page,
      async () => {
        const actual = { contact: await count('contact'), coil: await count('coil'), block: await count('block') }
        shown = JSON.stringify(actual)
        return actual.contact === wanted.contact && actual.coil === wanted.coil && actual.block === wanted.block
      },
      {
        timeout: 10_000,
        failure: BUILD_FAILURE,
        message: `${context}: the rung does not hold ${JSON.stringify(wanted)} (contacts, coils, blocks)`,
      },
    ).catch((error: unknown) => {
      throw new Error(`${context}: the rung holds ${shown}, not ${JSON.stringify(wanted)}`, { cause: error })
    })
  }
}
