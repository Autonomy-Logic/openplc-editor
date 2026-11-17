/**
 * The editor's HMI preview end to end, outside the app: builds the sample project's preview with the shared build and
 * the real WebAssembly clang, runs the module with the shared HmiPreviewInstance, and checks frames, band skipping,
 * live setters, navigation, the widget-block preview and the time a rebuild takes after an edit.
 *
 *   npx ts-node -T -r tsconfig-paths/register tests/hmi-preview/run.ts
 *
 * HMI_PREVIEW_REBUILD_MS and HMI_PREVIEW_LIVE_MS override the limits (1500 and 50) on slow machines.
 */
import { cpus } from 'node:os'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildHmiPreview, type HmiPreviewResources } from '../../src/backend/shared/hmi/preview/build-hmi-preview'
import { createHmiPreviewPort } from '../../src/backend/shared/hmi/preview/hmi-preview-port'
import { serveHmiPreview } from '../../src/backend/shared/hmi/preview/preview-worker'
import { HmiPreviewInstance } from '../../src/backend/shared/hmi/preview/preview-instance'
import { WIDGET_PREVIEW_SCREEN } from '../../src/backend/shared/hmi/unit/generate-hmi-unit'
import { sampleProject } from '../../src/backend/shared/hmi/unit/__tests__/fixtures/sample-project'
import { isYowaspClang, runClangJob } from '../../src/backend/shared/wasm-toolchain/clang-worker-host'
import { type CachedWasmObject, compileToWasm } from '../../src/backend/shared/wasm-toolchain/compile-to-wasm'
import { createWasmCompileService } from '../../src/backend/shared/wasm-toolchain/wasm-compile-service'
import type {
  HmiPreviewWorkerHandle,
  HmiPreviewWorkerScope,
} from '../../src/middleware/shared/ports/hmi-preview-mechanisms'
import type { WasmClangRunner, WasmObjectStore } from '../../src/middleware/shared/ports/wasm-toolchain-mechanisms'
import type { WasmCompileRequest } from '../../src/middleware/shared/ports/wasm-toolchain-types'

const ROOT = join(__dirname, '..', '..')
const HMI = join(ROOT, 'resources', 'sources', 'hmi')
const RUNTIME = join(ROOT, 'node_modules', 'strucpp', 'src', 'runtime', 'include')
const REBUILD_MS = Number(process.env.HMI_PREVIEW_REBUILD_MS ?? 1500)
const LIVE_MS = Number(process.env.HMI_PREVIEW_LIVE_MS ?? 50)
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
    concurrency: Math.max(1, Math.min(4, cpus().length - 1)),
    prepare: () => Promise.resolve(),
    run: (job) => runClangJob(clang, job.argv, job.tree),
  }
}

const elapsed = (start: number): number => Math.round(performance.now() - start)

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

async function main(): Promise<void> {
  const clang = await runner()
  const cache = new Map<string, CachedWasmObject>()
  const compile = (request: WasmCompileRequest) => compileToWasm(request, { runner: clang, cache })
  const files = resources()

  let start = performance.now()
  const cold = await buildHmiPreview(sampleProject(), files, compile)
  if (!cold.ok) throw new Error(`cold build failed:\n${cold.errors.map((e) => `${e.file}: ${e.message}`).join('\n')}`)
  console.log(`cold build ${elapsed(start)} ms, ${cold.stats.units} units`)

  const edited = sampleProject()
  edited.screens = edited.screens.map((s) =>
    s.name === 'Overview' ? { ...s, source: s.source.replace('MaxValue := 10.0', 'MaxValue := 12.0') } : s,
  )
  start = performance.now()
  const rebuilt = await buildHmiPreview(edited, files, compile)
  const rebuildMs = elapsed(start)
  if (!rebuilt.ok) throw new Error('rebuild failed')
  console.log(`rebuild after an edit ${rebuildMs} ms, ${rebuilt.stats.cached} of ${rebuilt.stats.units} units cached`)
  check(
    rebuilt.stats.cached >= rebuilt.stats.units - 3,
    'an edit of one screen recompiles at most that screen, its setters and the glue',
  )
  check(rebuildMs <= REBUILD_MS, `rebuild after an edit within ${REBUILD_MS} ms`)

  const timed = async (what: string, input: Parameters<typeof buildHmiPreview>[0]): Promise<void> => {
    const t = performance.now()
    const build = await buildHmiPreview(input, files, compile)
    const ms = elapsed(t)
    console.log(`${what}: ${ms} ms${build.ok ? `, ${build.stats.cached} of ${build.stats.units} units cached` : ''}`)
    check(build.ok && ms <= REBUILD_MS, `${what} within ${REBUILD_MS} ms`)
  }
  const withElement = sampleProject()
  withElement.screens = withElement.screens.map((s) =>
    s.name === 'Details'
      ? {
          ...s,
          source: s.source.replace(
            '    Shown : HmiLabel;',
            "    Shown : HmiLabel;\n    Note : HmiLabel := (Text := 'Note');",
          ),
        }
      : s,
  )
  await timed('rebuild after adding an element', withElement)
  const withNewType = sampleProject()
  withNewType.screens = withNewType.screens.map((s) =>
    s.name === 'Details'
      ? { ...s, source: s.source.replace('    Shown : HmiLabel;', '    Shown : HmiLabel;\n    Dial : HmiGauge;') }
      : s,
  )
  await timed('rebuild after adding an element of a widget type no screen used', withNewType)
  const withScreen = sampleProject()
  withScreen.screens = [
    ...withScreen.screens,
    {
      name: 'Extra',
      source: 'FUNCTION_BLOCK Extra EXTENDS HmiScreen\n  VAR\n    L : HmiLabel;\n  END_VAR\nEND_FUNCTION_BLOCK\n',
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
