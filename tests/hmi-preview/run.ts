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
import type { HmiPreviewBuild } from '../../src/middleware/shared/ports/hmi-preview-types'
import type { WasmCompileRequest } from '../../src/middleware/shared/ports/wasm-toolchain-types'
import { addElement } from '../../src/middleware/shared/utils/hmi/designer/designer-edits'
import { planLiveElements } from '../../src/middleware/shared/utils/hmi/designer/designer-live'
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

/**
 * Elements added to a running preview from the designer's edit, without a build: each is drawn at once, without a
 * compile, and the frame and the elements' bounds equal those of the module the edit then builds.
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

  type Edit = (source: string, model: DesignerModel) => { source: string; names: string[] }
  const add =
    (...specs: Parameters<typeof addElement>[2][]): Edit =>
    (source, model) => {
      const names: string[] = []
      let text = source
      let current = model
      for (const spec of specs) {
        const result = addElement(text, current, spec)
        if (!result.ok || !result.name) throw new Error(result.ok ? 'no name' : result.message)
        names.push(result.name)
        text = result.source
        current = parse(text)
      }
      return { source: text, names }
    }
  const cases: Array<[string, string, Edit]> = [
    [
      'a label dropped at the end of a stack',
      'Details',
      add({ type: 'HmiLabel', parent: 'Body', props: [['Text', "'Note'"]] }),
    ],
    [
      'a gauge dropped before a sibling, with its type default',
      'Details',
      add({ type: 'HmiGauge', parent: 'Body', before: 'Shown' }),
    ],
    [
      'a widget block dropped into a nested stack',
      'Overview',
      add({ type: 'Badge', parent: 'Col', before: 'Run', props: [['Caption', "'New'"]] }),
    ],
    [
      'a lamp dropped on a diagram at a position',
      'Plant',
      add({
        type: 'HmiLamp',
        parent: 'Diagram',
        props: [
          ['X', '200'],
          ['Y', '120'],
        ],
      }),
    ],
    [
      'a stack pasted with a label inside',
      'Details',
      add(
        { type: 'HmiVerticalStack', parent: 'Body', before: 'Back' },
        { type: 'HmiLabel', parent: 'VerticalStack1', props: [['Text', "'In'"]] },
      ),
    ],
  ]
  for (const [what, screen, edit] of cases) {
    const page = before.pages[screen]
    const running = await HmiPreviewInstance.create(before.wasm, WIDTH, HEIGHT)
    running.design(true)
    running.show(page)
    const live = new FullFrame(running)
    live.draw()
    const source = base.screens.find((s) => s.name === screen)?.source ?? ''
    const edited = edit(source, parse(source))
    const ids = new Map(
      before.elementIds.filter((e) => e.screen === screen).map((e) => [e.element.toUpperCase(), e.id]),
    )
    const compilesBefore = compiles
    const start = performance.now()
    const plan = planLiveElements({
      model: parse(edited.source),
      added: edited.names,
      catalog,
      factory: before.factory,
      idOf: (name) => ids.get(name.toUpperCase()),
    })
    const added = plan ? running.addLive(plan.elements) : null
    live.draw()
    const ms = performance.now() - start
    check(
      added !== null && compiles === compilesBefore && ms <= LIVE_ADD_MS,
      `${what}: drawn without a compile within ${LIVE_ADD_MS} ms (${ms.toFixed(2)} ms)`,
    )

    const project = {
      ...base,
      screens: base.screens.map((s) => (s.name === screen ? { ...s, source: edited.source } : s)),
    }
    const after = await buildHmiPreview(project, files, counted)
    if (!after.ok || !added || !plan) {
      check(false, `${what}: the edit builds`)
      continue
    }
    const rebuilt = await HmiPreviewInstance.create(after.wasm, WIDTH, HEIGHT)
    rebuilt.design(true)
    rebuilt.show(page)
    const reference = new FullFrame(rebuilt)
    reference.draw()
    reference.draw()
    const same = live.rgba.every((byte, i) => byte === reference.rgba[i])
    check(same, `${what}: the frame equals the rebuilt module's`)
    const box = (instance: HmiPreviewInstance, id: number | undefined) => {
      const b = instance.bounds().find((x) => x.id === id)
      return b ? `${b.x},${b.y},${b.width},${b.height}` : 'none'
    }
    const boxes = plan.names.map((name, i) => {
      const id = after.elementIds.find((e) => e.screen === screen && e.element === name)?.id
      return [box(running, added[i]), box(rebuilt, id)]
    })
    if (screen === 'Details') {
      running.show(before.pages.Overview)
      running.frame(0)
      const left = !running.setLiveNumber(added[0], 0, 1)
      running.show(page)
      running.frame(0)
      running.removeLive(added)
      check(left && running.bounds().every((b) => !added.includes(b.id)), `${what}: leaving the screen ends it`)
    }
    check(
      boxes.every(([a, b]) => a !== 'none' && a === b),
      `${what}: the new elements have the rebuilt module's bounds (${boxes.map((b) => b.join(' / ')).join('; ')})`,
    )
  }
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
