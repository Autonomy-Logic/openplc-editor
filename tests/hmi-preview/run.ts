/**
 * The editor's HMI preview end to end, outside the app: builds the sample project's preview with the shared build and
 * the real WebAssembly clang, runs the module with the shared HmiPreviewInstance, and checks frames, band skipping,
 * live setters, navigation, the widget-block preview and the time a rebuild takes after an edit.
 *
 *   npx ts-node -T -r tsconfig-paths/register tests/hmi-preview/run.ts
 *
 * It also adds elements to a running module without a build and checks that each is drawn without a compile, with the
 * frame and bounds of the module the edit then builds, and prints where each build spent its time.
 *
 * HMI_PREVIEW_REBUILD_MS, HMI_PREVIEW_LIVE_MS and HMI_PREVIEW_LIVE_ADD_MS override the limits (1500, 50 and 50) on
 * slow machines.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildHmiPreview, type HmiPreviewResources } from '../../src/backend/shared/hmi/preview/build-hmi-preview'
import { createHmiPreviewPort } from '../../src/backend/shared/hmi/preview/hmi-preview-port'
import { serveHmiPreview } from '../../src/backend/shared/hmi/preview/preview-worker'
import { HmiPreviewInstance } from '../../src/backend/shared/hmi/preview/preview-instance'
import { buildHmiWidgetCatalog, WIDGET_PREVIEW_SCREEN } from '../../src/backend/shared/hmi/unit/generate-hmi-unit'
import { sampleProject } from '../../src/backend/shared/hmi/unit/__tests__/fixtures/sample-project'
import { isYowaspClang, runClangJob } from '../../src/backend/shared/wasm-toolchain/clang-worker-host'
import { type CachedWasmObject, compileToWasm } from '../../src/backend/shared/wasm-toolchain/compile-to-wasm'
import { createWasmCompileService } from '../../src/backend/shared/wasm-toolchain/wasm-compile-service'
import type {
  HmiPreviewWorkerHandle,
  HmiPreviewWorkerScope,
} from '../../src/middleware/shared/ports/hmi-preview-mechanisms'
import type { WasmClangRunner, WasmObjectStore } from '../../src/middleware/shared/ports/wasm-toolchain-mechanisms'
import type { HmiPreviewBuild, HmiWidgetCatalog } from '../../src/middleware/shared/ports/hmi-preview-types'
import type { WasmCompileRequest } from '../../src/middleware/shared/ports/wasm-toolchain-types'
import { liveValue } from '../../src/middleware/shared/utils/hmi/designer/designer-canvas'
import { withTheirPipes } from '../../src/middleware/shared/utils/hmi/designer/designer-diagram'
import {
  addElement,
  deleteElements,
  type DesignerEdit,
  moveElement,
  setProperty,
} from '../../src/middleware/shared/utils/hmi/designer/designer-edits'
import { liveDeclaration, planLiveSync } from '../../src/middleware/shared/utils/hmi/designer/designer-live'
import { type DesignerModel, parseDesignerBlock } from '../../src/middleware/shared/utils/hmi/designer/designer-model'
import {
  formatHmiPreviewTimings,
  type HmiPreviewRunTimings,
} from '../../src/middleware/shared/utils/hmi/preview-timings'

const ROOT = join(__dirname, '..', '..')
const HMI = join(ROOT, 'resources', 'sources', 'hmi')
const RUNTIME = join(ROOT, 'node_modules', 'strucpp', 'src', 'runtime', 'include')
const REBUILD_MS = Number(process.env.HMI_PREVIEW_REBUILD_MS ?? 1500)
const LIVE_MS = Number(process.env.HMI_PREVIEW_LIVE_MS ?? 50)
const LIVE_ADD_MS = Number(process.env.HMI_PREVIEW_LIVE_ADD_MS ?? 50)
const WIDTH = 800
const HEIGHT = 480

const failures: string[] = []
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

function textFiles(dir: string, prefix: string, keep: (name: string) => boolean): Record<string, string> {
  const files: Record<string, string> = {}
  for (const name of readdirSync(dir)) if (keep(name)) files[`${prefix}${name}`] = readFileSync(join(dir, name), 'utf8')
  return files
}

/** Every file under a folder, by path relative to it: sources as text, everything else as bytes. */
function readAll(dir: string, prefix = ''): Record<string, string | Uint8Array> {
  const out: Record<string, string | Uint8Array> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(out, readAll(path, `${prefix}${entry.name}/`))
    else
      out[`${prefix}${entry.name}`] = /\.(c|h|cpp|hpp)$/.test(entry.name)
        ? readFileSync(path, 'utf8')
        : new Uint8Array(readFileSync(path))
  }
  return out
}

function resources(): HmiPreviewResources {
  const source = (name: string) => /\.(c|h|cpp)$/.test(name)
  return {
    runtimeHeaders: textFiles(RUNTIME, '', (n) => n.endsWith('.hpp')),
    hmiSources: {
      ...textFiles(join(HMI, 'core'), 'core/', source),
      ...textFiles(join(HMI, 'core', 'third_party'), 'core/third_party/', source),
      ...textFiles(join(HMI, 'unit'), 'unit/', source),
      ...textFiles(join(HMI, 'preview'), 'preview/', source),
    },
    readFont: (file) => Promise.resolve(new Uint8Array(readFileSync(join(HMI, 'fonts', file)))),
  }
}

async function runner(): Promise<WasmClangRunner> {
  const clang: unknown = await import('@yowasp/clang')
  if (!isYowaspClang(clang)) throw new Error('@yowasp/clang is not the expected module')
  return {
    concurrency: 1,
    prepare: () => Promise.resolve(),
    run: (job) => runClangJob(clang, job.argv, job.tree),
    release: () => Promise.resolve(),
  }
}

const elapsed = (start: number): number => Math.round(performance.now() - start)

/** Starts a built module and draws its first frame, timing both. */
async function startAndDraw(wasm: Uint8Array): Promise<HmiPreviewRunTimings> {
  let start = performance.now()
  const instance = await HmiPreviewInstance.create(wasm, WIDTH, HEIGHT)
  const startMs = performance.now() - start
  start = performance.now()
  instance.frame(0)
  instance.render(WIDTH, HEIGHT, 1)
  return { startMs, firstFrameMs: performance.now() - start }
}

/** Prints where a build spent its time, with the start and first frame of its module. */
async function breakdown(what: string, build: HmiPreviewBuild): Promise<void> {
  if (!build.ok || !build.timings) return
  console.log(`  ${what}: ${formatHmiPreviewTimings(build.timings, build.stats, await startAndDraw(build.wasm))}`)
}

type Listener = (event: MessageEvent<unknown>) => void

/** A Worker in this process: messages cross with structuredClone and transfers, asynchronously, as between threads. */
function inProcessWorker(serve: boolean): HmiPreviewWorkerHandle {
  const toWorker: Listener[] = []
  const toPage: Listener[] = []
  let alive = true
  const deliver = (listeners: Listener[], message: unknown, transfer: Transferable[]) => {
    const data = structuredClone(message, { transfer })
    setTimeout(() => alive && listeners.forEach((l) => l(new MessageEvent('message', { data }))), 0)
  }
  const scope: HmiPreviewWorkerScope = {
    postMessage: (message, transfer) => deliver(toPage, message, transfer),
    addEventListener: (_type, listener) => toWorker.push(listener),
  }
  if (serve) serveHmiPreview(scope)
  return {
    postMessage: (message, transfer) => deliver(toWorker, message, transfer),
    addEventListener: (type: 'message' | 'error', listener: Listener | ((event: ErrorEvent) => void)) => {
      if (type === 'message') toPage.push(listener as Listener)
    },
    terminate: () => {
      alive = false
    },
  }
}

/** A screen with a diagram, for elements dropped at a position. */
const PLANT = `FUNCTION_BLOCK Plant EXTENDS HmiScreen
  VAR
    Body : HmiHorizontalStack;
    Diagram : HmiDiagram := (Parent := 'Body', DesignW := 400, DesignH := 240);
    Tank : HmiTank := (Parent := 'Diagram', X := 20, Y := 20, Caption := 'T1');
  END_VAR
END_FUNCTION_BLOCK
`

type Compile = (request: WasmCompileRequest) => ReturnType<typeof compileToWasm>

/** A frame drawn in full: the first render of a module, with every later render's changed rows copied in. */
class FullFrame {
  readonly rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  constructor(private readonly instance: HmiPreviewInstance) {}
  draw(): void {
    this.instance.frame(0)
    const pixels = this.instance.render(WIDTH, HEIGHT, 1)
    if (pixels) this.rgba.set(pixels.rgba, pixels.y0 * WIDTH * 4)
  }
}

/** An element of the shown screen in a running module, as the designer's preview hook tracks it. */
interface Held {
  id: number
  type: string
  created: boolean
  attached: boolean
  declaration?: string
}

/**
 * A running module driven as the designer's preview hook drives it: each source of a screen is reached from the one
 * the module shows with `planLiveSync`, the module's change and live setters, without a build.
 */
class LiveDriver {
  readonly frame: FullFrame
  private shown: DesignerModel
  private shownSource: string
  private readonly held = new Map<string, Held>()

  constructor(
    readonly instance: HmiPreviewInstance,
    private readonly built: Extract<HmiPreviewBuild, { ok: true }>,
    private readonly screen: string,
    private readonly catalog: HmiWidgetCatalog,
    private readonly parse: (source: string) => DesignerModel,
    source: string,
  ) {
    this.frame = new FullFrame(instance)
    this.shown = parse(source)
    this.shownSource = source
    for (const e of built.elementIds)
      if (e.screen === screen)
        this.held.set(e.element.toUpperCase(), { id: e.id, type: '', created: false, attached: true })
  }

  /** The module's id of an element that is laid out and drawn. */
  idOf(name: string): number | undefined {
    const held = this.held.get(name.toUpperCase())
    return held?.attached ? held.id : undefined
  }

  /** Shows `source` without a build; false when the planner or the module refuses. */
  show(source: string): boolean {
    const next = this.parse(source)
    const plan = planLiveSync({
      shown: this.shown,
      shownSource: this.shownSource,
      next,
      nextSource: source,
      catalog: this.catalog,
      factory: this.built.factory,
      module: {
        attached: (name) => this.idOf(name),
        detached: (name) => {
          const held = this.held.get(name.toUpperCase())
          return held && !held.attached ? { id: held.id, declaration: held.declaration ?? '' } : undefined
        },
        created: (name) => this.held.get(name.toUpperCase())?.created ?? false,
      },
    })
    if (!plan) return false
    const ids = this.instance.changeLive(plan.detach, plan.elements)
    if (!ids) return false
    for (const name of plan.detached) {
      const held = this.held.get(name.toUpperCase())
      const declared = this.shown.elements.find((e) => e.name.toUpperCase() === name.toUpperCase())
      if (held) {
        held.attached = false
        held.declaration = declared ? liveDeclaration(this.shownSource, declared) : ''
      }
    }
    plan.names.forEach((name, i) => {
      const before = this.held.get(name.toUpperCase())
      const created = plan.elements[i].element === undefined
      const type = next.elements.find((e) => e.name.toUpperCase() === name.toUpperCase())?.type.toUpperCase() ?? ''
      this.held.set(name.toUpperCase(), {
        id: ids[i],
        type: created ? type : (before?.type ?? ''),
        created: created || (before?.created ?? false),
        attached: true,
      })
    })
    for (const v of plan.values) {
      const live = liveValue(v.value)
      const held = this.held.get(v.element.toUpperCase())
      if (!live || !held) return false
      const page = this.built.pages[this.screen]
      const setter = held.created
        ? this.built.factory.types[held.type]?.setters[v.property.toUpperCase()]
        : Object.entries(this.built.setters).find(
            ([k]) => k.toUpperCase() === `${this.screen}.${v.element}.${v.property}`.toUpperCase(),
          )?.[1]
      if (!setter) return false
      const applied =
        'number' in live
          ? held.created
            ? this.instance.setLiveNumber(held.id, setter.index, live.number)
            : this.instance.setNumber(page, setter.index, live.number)
          : held.created
            ? this.instance.setLiveText(held.id, setter.index, live.text)
            : this.instance.setText(page, setter.index, live.text)
      if (!applied) return false
    }
    this.shown = next
    this.shownSource = source
    return true
  }
}

/**
 * Structural edits of a running preview from the designer's edits, without a build: elements added, removed and
 * moved, values changed, and each undone and redone. Every step is drawn at once without a compile, and its frame and
 * every element's bounds equal those of the module the step's source builds.
 */
async function liveElementChecks(files: HmiPreviewResources, compile: Compile): Promise<void> {
  let compiles = 0
  const counted: Compile = (request) => {
    compiles++
    return compile(request)
  }
  const { catalog } = buildHmiWidgetCatalog(sampleProject().widgets)
  const isWidget = (type: string) => catalog.widgets.has(type.toUpperCase())
  const parse = (source: string): DesignerModel => {
    const parsed = parseDesignerBlock(source, isWidget)
    if (!parsed.ok) throw new Error(parsed.errors.map((e) => e.message).join('\n'))
    return parsed.model
  }
  const base = { ...sampleProject(), screens: [...sampleProject().screens, { name: 'Plant', source: PLANT }] }
  const before = await buildHmiPreview(base, files, counted)
  if (!before.ok) throw new Error('the live elements base did not build')
  const builds = new Map<string, Extract<HmiPreviewBuild, { ok: true }>>()
  const buildOf = async (screen: string, source: string) => {
    const key = `${screen}\u0000${source}`
    const known = builds.get(key)
    if (known) return known
    const project = { ...base, screens: base.screens.map((s) => (s.name === screen ? { ...s, source } : s)) }
    const built = await buildHmiPreview(project, files, counted)
    if (!built.ok) throw new Error(`${screen} does not build: ${built.errors.map((e) => e.message).join('; ')}`)
    builds.set(key, built)
    return built
  }

  type Edit = (source: string, model: DesignerModel) => string
  const must = (result: DesignerEdit): string => {
    if (!result.ok) throw new Error(result.message)
    return result.source
  }
  const add =
    (...specs: Parameters<typeof addElement>[2][]): Edit =>
    (source) =>
      specs.reduce((text, spec) => must(addElement(text, parse(text), spec)), source)
  const remove =
    (...names: string[]): Edit =>
    (source, model) =>
      must(deleteElements(source, model, withTheirPipes(model, catalog, names)))
  const move =
    (name: string, parent: string | null, beforeName: string | null): Edit =>
    (source, model) =>
      must(moveElement(source, model, name, parent, beforeName))
  const set =
    (element: string, property: string, value: string): Edit =>
    (source, model) =>
      must(setProperty(source, model, element, property, value))
  /** A case: the screen, then edits applied one after the other; `undo` goes back through the sources, `redo` forward. */
  const cases: Array<[string, string, Edit[]]> = [
    [
      'add a label at the end of a stack',
      'Details',
      [add({ type: 'HmiLabel', parent: 'Body', props: [['Text', "'Note'"]] })],
    ],
    [
      'add a gauge before a sibling, with its type default',
      'Details',
      [add({ type: 'HmiGauge', parent: 'Body', before: 'Shown' })],
    ],
    [
      'add a widget block into a nested stack',
      'Overview',
      [add({ type: 'Badge', parent: 'Col', before: 'Run', props: [['Caption', "'New'"]] })],
    ],
    [
      'add a lamp on a diagram at a position',
      'Plant',
      [
        add({
          type: 'HmiLamp',
          parent: 'Diagram',
          props: [
            ['X', '200'],
            ['Y', '120'],
          ],
        }),
      ],
    ],
    [
      'add a stack with a label inside',
      'Details',
      [
        add(
          { type: 'HmiVerticalStack', parent: 'Body', before: 'Back' },
          { type: 'HmiLabel', parent: 'VerticalStack1', props: [['Text', "'In'"]] },
        ),
      ],
    ],
    ['remove the last element of a stack', 'Overview', [remove('Setpoint')]],
    ['remove an element in the middle of a stack', 'Overview', [remove('Speed')]],
    ['remove a container with what it holds', 'Overview', [remove('Col')]],
    ['remove an element of a diagram', 'Plant', [remove('Tank')]],
    [
      'add a label, then remove it',
      'Details',
      [add({ type: 'HmiLabel', parent: 'Body', props: [['Text', "'Gone'"]] }), remove('Label1')],
    ],
    ['reorder an element to an earlier place in its stack', 'Overview', [move('Next', 'Body', 'Speed')]],
    ['reorder an element to a later place in its stack', 'Overview', [move('Speed', 'Body', 'Next')]],
    ['move an element to another stack', 'Overview', [move('Run', 'Body', 'Name')]],
    ['move a stack with what it holds', 'Overview', [move('Col', 'Body', null)]],
    ['move an element on a diagram', 'Plant', [set('Tank', 'X', '140'), set('Tank', 'Y', '90')]],
    ['change a text', 'Overview', [set('Next', 'Text', "'Go on'")]],
    [
      'add a lamp, undo it, then add one of that name on a diagram',
      'Plant',
      [
        add({ type: 'HmiLamp', parent: 'Body' }),
        remove('Lamp1'),
        add({
          type: 'HmiLamp',
          parent: 'Diagram',
          props: [
            ['X', '220'],
            ['Y', '60'],
          ],
        }),
      ],
    ],
  ]
  const timings: Array<[string, number, number]> = []
  for (const [what, screen, edits] of cases) {
    const page = before.pages[screen]
    const original = base.screens.find((s) => s.name === screen)?.source ?? ''
    const sources = [original]
    for (const edit of edits) sources.push(edit(sources[sources.length - 1], parse(sources[sources.length - 1])))
    const running = await HmiPreviewInstance.create(before.wasm, WIDTH, HEIGHT)
    running.design(true)
    running.show(page)
    const driver = new LiveDriver(running, before, screen, catalog, parse, original)
    driver.frame.draw()
    const steps: Array<[string, string]> = [
      ...sources.slice(1).map((source, i): [string, string] => [`step ${i + 1}`, source]),
      ...sources
        .slice(0, -1)
        .reverse()
        .map((source, i): [string, string] => [`undo ${i + 1}`, source]),
      ...sources.slice(1).map((source, i): [string, string] => [`redo ${i + 1}`, source]),
    ]
    let worst = 0
    let failed = ''
    let buildMs = 0
    for (const [step, source] of steps) {
      const compilesBefore = compiles
      const start = performance.now()
      const shown = driver.show(source)
      driver.frame.draw()
      const ms = performance.now() - start
      worst = Math.max(worst, ms)
      if (!shown || compiles !== compilesBefore || ms > LIVE_ADD_MS) {
        failed ||= `${step} ${shown ? `took ${ms.toFixed(2)} ms` : 'was refused'}`
        continue
      }
      const buildStart = performance.now()
      const built = await buildOf(screen, source)
      if (step === 'step 1') buildMs = performance.now() - buildStart
      const rebuilt = await HmiPreviewInstance.create(built.wasm, WIDTH, HEIGHT)
      rebuilt.design(true)
      rebuilt.show(page)
      const reference = new FullFrame(rebuilt)
      reference.draw()
      reference.draw()
      if (!driver.frame.rgba.every((byte, i) => byte === reference.rgba[i])) failed ||= `${step}: the frame differs`
      const boxes = new Map(
        rebuilt
          .bounds()
          .filter((b) => b.id > 0)
          .map((b) => [b.id, b]),
      )
      for (const e of built.elementIds.filter((x) => x.screen === screen)) {
        const want = boxes.get(e.id)
        const id = driver.idOf(e.element)
        const got = running.bounds().find((b) => b.id === id)
        if (!want && !got) continue
        if (
          !want ||
          !got ||
          want.x !== got.x ||
          want.y !== got.y ||
          want.width !== got.width ||
          want.height !== got.height
        )
          failed ||= `${step}: ${e.element} is at ${got ? `${got.x},${got.y},${got.width},${got.height}` : 'nowhere'}`
      }
      const attachedIds = new Set(parse(source).elements.map((x) => driver.idOf(x.name)))
      for (const b of running.bounds())
        if (b.id > 0 && !attachedIds.has(b.id)) failed ||= `${step}: element ${b.id} is still drawn`
    }
    timings.push([what, worst, buildMs])
    check(
      failed === '',
      `${what}, undone and redone: each step drawn without a compile within ${LIVE_ADD_MS} ms (worst ${worst.toFixed(2)} ms) with the rebuilt module's frame and bounds${failed ? `; ${failed}` : ''}`,
    )
  }

  const running = await HmiPreviewInstance.create(before.wasm, WIDTH, HEIGHT)
  running.design(true)
  running.show(before.pages.Overview)
  const original = base.screens.find((s) => s.name === 'Overview')?.source ?? ''
  const driver = new LiveDriver(running, before, 'Overview', catalog, parse, original)
  driver.frame.draw()
  const nextId = driver.idOf('Next')
  const button = running.bounds().find((b) => b.id === nextId)
  const removed = remove('Next')(original, parse(original))
  check(driver.show(removed), 'the Next button is removed live')
  driver.frame.draw()
  if (button) {
    const x = button.x + button.width / 2
    const y = button.y + button.height / 2
    running.pointer('down', x, y)
    running.frame(50)
    running.pointer('up', x, y)
    running.frame(100)
  }
  check(
    button !== undefined && running.frame(150).page === before.pages.Overview,
    'a tap where a removed button was does nothing',
  )

  const leaving = await HmiPreviewInstance.create(before.wasm, WIDTH, HEIGHT)
  leaving.show(before.pages.Details)
  const details = base.screens.find((s) => s.name === 'Details')?.source ?? ''
  const away = new LiveDriver(leaving, before, 'Details', catalog, parse, details)
  away.frame.draw()
  check(
    away.show(add({ type: 'HmiLabel', parent: 'Body', props: [['Text', "'Note'"]] })(details, parse(details))),
    'a label is added live',
  )
  const added = away.idOf('Label1') ?? -1
  leaving.show(before.pages.Overview)
  leaving.frame(0)
  const left = !leaving.setLiveNumber(added, 0, 1)
  leaving.show(before.pages.Details)
  leaving.frame(0)
  check(left && leaving.bounds().every((b) => b.id !== added), 'leaving the screen ends live changes')
  console.log(
    timings
      .map(([what, ms, build]) => `  live: ${what}: worst step ${ms.toFixed(2)} ms; its build ${Math.round(build)} ms`)
      .join('\n'),
  )
}

async function main(): Promise<void> {
  const clang = await runner()
  const cache = new Map<string, CachedWasmObject>()
  const compile = (request: WasmCompileRequest) => compileToWasm(request, { runner: clang, cache })
  const files = resources()

  let start = performance.now()
  const cold = await buildHmiPreview(sampleProject(), files, compile)
  if (!cold.ok) throw new Error(`cold build failed:\n${cold.errors.map((e) => `${e.file}: ${e.message}`).join('\n')}`)
  console.log(`cold build ${elapsed(start)} ms, ${cold.stats.units} units`)
  await breakdown('cold build', cold)

  const edited = sampleProject()
  edited.screens = edited.screens.map((s) =>
    s.name === 'Overview' ? { ...s, source: s.source.replace('MaxValue := 10.0', 'MaxValue := 12.0') } : s,
  )
  start = performance.now()
  const rebuilt = await buildHmiPreview(edited, files, compile)
  const rebuildMs = elapsed(start)
  if (!rebuilt.ok) throw new Error('rebuild failed')
  console.log(`rebuild after an edit ${rebuildMs} ms, ${rebuilt.stats.cached} of ${rebuilt.stats.units} units cached`)
  await breakdown('rebuild after an edit', rebuilt)
  check(
    rebuilt.stats.cached >= rebuilt.stats.units - 3,
    'an edit of one screen recompiles at most that screen, its setters and the glue',
  )
  check(rebuildMs <= REBUILD_MS, `rebuild after an edit within ${REBUILD_MS} ms`)

  const timed = async (what: string, input: Parameters<typeof buildHmiPreview>[0]): Promise<HmiPreviewBuild> => {
    const t = performance.now()
    const build = await buildHmiPreview(input, files, compile)
    const ms = elapsed(t)
    console.log(`${what}: ${ms} ms${build.ok ? `, ${build.stats.cached} of ${build.stats.units} units cached` : ''}`)
    await breakdown(what, build)
    check(build.ok && ms <= REBUILD_MS, `${what} within ${REBUILD_MS} ms`)
    return build
  }
  await timed('rebuild of the sample project', sampleProject())
  const withElement = sampleProject()
  withElement.screens = withElement.screens.map((s) =>
    s.name === 'Details'
      ? {
          ...s,
          source: s.source.replace(
            "    Shown : HmiLabel := (Parent := 'Body');",
            "    Shown : HmiLabel := (Parent := 'Body');\n    Note : HmiLabel := (Text := 'Note', Parent := 'Body');",
          ),
        }
      : s,
  )
  const added = await timed('rebuild after adding an element', withElement)
  check(
    added.ok && added.stats.cached === added.stats.units - 2,
    'adding an element to one screen recompiles that screen and the glue, not the other screens',
  )
  const withNewType = sampleProject()
  withNewType.screens = withNewType.screens.map((s) =>
    s.name === 'Details'
      ? {
          ...s,
          source: s.source.replace(
            "    Shown : HmiLabel := (Parent := 'Body');",
            "    Shown : HmiLabel := (Parent := 'Body');\n    Dial : HmiGauge := (Parent := 'Body');",
          ),
        }
      : s,
  )
  await timed('rebuild after adding an element of a widget type no screen used', withNewType)
  const withScreen = sampleProject()
  withScreen.screens = [
    ...withScreen.screens,
    {
      name: 'Extra',
      source:
        "FUNCTION_BLOCK Extra EXTENDS HmiScreen\n  VAR\n    S : HmiHorizontalStack;\n    L : HmiLabel := (Parent := 'S');\n  END_VAR\nEND_FUNCTION_BLOCK\n",
    },
  ]
  await timed('rebuild after adding a screen', withScreen)
  await timed('widget-block preview after the screens', { ...sampleProject(), screens: [], widgetPreview: 'Badge' })

  const preview = await HmiPreviewInstance.create(rebuilt.wasm, WIDTH, HEIGHT)
  preview.show(rebuilt.pages.Overview)
  const first = preview.frame(0)
  check(first.page === rebuilt.pages.Overview && first.status === 0, 'shows the requested screen with a clean frame')
  const pixels = preview.render(WIDTH, HEIGHT, 1)
  check(pixels !== null && pixels.y0 === 0 && pixels.rows === HEIGHT, 'the first render draws every row')
  const colours = new Set<number>()
  if (pixels)
    for (let i = 0; i < pixels.rgba.length; i += 4 * 97)
      colours.add(pixels.rgba[i] * 65536 + pixels.rgba[i + 1] * 256 + pixels.rgba[i + 2])
  check(colours.size > 4, 'the frame has content')
  preview.frame(50)
  check(preview.render(WIDTH, HEIGHT, 1) === null, 'an unchanged frame transfers nothing')

  const caption = rebuilt.setters['Overview.Level.Caption']
  const gap = rebuilt.setters['Overview.Col.Gap']
  start = performance.now()
  const textApplied = caption !== undefined && preview.setText(caption.screen, caption.index, 'Tank level')
  preview.frame(100)
  const textFrame = preview.render(WIDTH, HEIGHT, 1)
  const liveMs = performance.now() - start
  check(textApplied && textFrame !== null && textFrame.rows < HEIGHT, 'a text setter redraws only the bands it changed')
  check(liveMs <= LIVE_MS, `set, frame and render within ${LIVE_MS} ms (${liveMs.toFixed(2)} ms)`)
  const numberApplied = gap !== undefined && preview.setNumber(gap.screen, gap.index, 40)
  preview.frame(150)
  check(numberApplied && preview.render(WIDTH, HEIGHT, 1) !== null, 'a numeric setter moves the layout')
  check(!preview.setNumber(gap?.screen ?? 0, 9999, 1), 'an unknown setter is refused')

  const next = rebuilt.elementIds.find((e) => e.screen === 'Overview' && e.element === 'Next')
  const button = preview.bounds().find((b) => b.id === next?.id)
  if (button) {
    const x = button.x + button.width / 2
    const y = button.y + button.height / 2
    preview.pointer('down', x, y)
    preview.frame(150)
    preview.pointer('up', x, y)
    preview.frame(200)
  }
  check(preview.frame(250).page === rebuilt.pages.Details, 'a tap on Next shows Details')

  start = performance.now()
  const widget = await buildHmiPreview({ ...sampleProject(), screens: [], widgetPreview: 'Badge' }, files, compile)
  console.log(`widget-block preview build ${elapsed(start)} ms`)
  check(widget.ok, 'a widget block builds on its own')
  if (widget.ok) {
    const instance = await HmiPreviewInstance.create(widget.wasm, 320, 240)
    instance.show(widget.pages[WIDGET_PREVIEW_SCREEN])
    instance.frame(0)
    const drawn = instance.render(320, 240, 1)
    const natural = widget.elementIds.find((e) => e.element === 'Natural')
    const stretched = widget.elementIds.find((e) => e.element === 'Stretched')
    const box = (id: number | undefined) => instance.bounds().find((b) => b.id === id)
    const a = box(natural?.id)
    const b = box(stretched?.id)
    check(drawn !== null && a !== undefined && b !== undefined, 'the widget block is drawn twice')
    check(
      a !== undefined && b !== undefined && b.width > a.width && b.height > a.height,
      'the stretched copy is larger than the natural one',
    )
  }

  await liveElementChecks(files, compile)

  const port = createHmiPreviewPort(
    {
      readHmiSources: () => Promise.resolve({ root: `${HMI}/`, files: readAll(HMI, `${HMI}/`) }),
      readStrucppRuntimeHeaders: () => Promise.resolve(files.runtimeHeaders),
      compileToWasm: compile,
      startWorker: () => inProcessWorker(true),
    },
    { callTimeoutMs: 500 },
  )
  const viaPort = await port.build(sampleProject())
  check(viaPort.ok, 'the port builds with the resources the platform reads')
  if (viaPort.ok) {
    const session = port.openSession()
    await session.load(viaPort.wasm, { width: WIDTH, height: HEIGHT, page: viaPort.pages.Overview, design: false })
    const frame = await session.frame(0, { width: WIDTH, height: HEIGHT, scale: 1 })
    check(
      frame.pixels !== null && frame.pixels.rows === HEIGHT && frame.bounds.length > 0,
      'a session draws through its Worker',
    )
    const caption = viaPort.setters['Overview.Level.Caption']
    check(
      caption !== undefined && (await session.setText(caption.screen, caption.index, 'Tank')),
      'a session applies a live edit',
    )
    const next = await session.frame(50, { width: WIDTH, height: HEIGHT, scale: 1 })
    check(next.pixels !== null && next.pixels.rows < HEIGHT, 'the next frame carries only the changed rows')
    session.close()
  }
  const silent = createHmiPreviewPort(
    {
      readHmiSources: () => Promise.resolve({ root: '', files: {} }),
      readStrucppRuntimeHeaders: () => Promise.resolve({}),
      compileToWasm: compile,
      startWorker: () => inProcessWorker(false),
    },
    { loadTimeoutMs: 200 },
  ).openSession()
  const stopReason = await silent.load(cold.wasm, { width: WIDTH, height: HEIGHT, page: 0, design: false }).then(
    () => 'loaded',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )
  check(stopReason === 'The preview stopped responding', 'a Worker that never answers is stopped by the watchdog')

  const records = new Map<string, Uint8Array>()
  const store: WasmObjectStore = {
    readAll: () => Promise.resolve([...records.entries()]),
    write: (key, record) => Promise.resolve(void records.set(key, record)),
    remove: (key) => Promise.resolve(void records.delete(key)),
  }
  const earlier = createWasmCompileService(clang, store)
  await earlier.prepare()
  await buildHmiPreview(sampleProject(), files, (request) => earlier.compile(request))
  await new Promise((resolve) => setTimeout(resolve, 50))
  const restarted = createWasmCompileService(clang, store)
  await restarted.prepare()
  start = performance.now()
  const afterRestart = await buildHmiPreview(sampleProject(), files, (request) => restarted.compile(request))
  const restartMs = elapsed(start)
  console.log(
    `first build after a restart: ${restartMs} ms${afterRestart.ok ? `, ${afterRestart.stats.cached} of ${afterRestart.stats.units} units from the store` : ''}`,
  )
  check(
    afterRestart.ok && afterRestart.stats.cached === afterRestart.stats.units,
    'a restart reuses every stored object',
  )
  check(restartMs <= REBUILD_MS, `first build after a restart within ${REBUILD_MS} ms`)

  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed`)
    process.exit(1)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
