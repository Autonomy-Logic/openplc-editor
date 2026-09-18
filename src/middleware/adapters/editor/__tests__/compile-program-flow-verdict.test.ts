/**
 * A build's outcome comes from the pipeline's verdict, not from whether
 * anything was logged at error level.
 *
 * The two are different questions, and conflating them broke real uploads. A
 * compiler writes warnings to stderr; the device tags that stream and streams
 * it back; so a build that merely warned arrived with error-level lines in it
 * and resolved as a FAILURE — reported as `upload_rejected` whose message was
 * a bare `^~~~` caret line, on a build the device had completed and started.
 *
 * `runCompilePipeline` already reduces every step's process exit code to one
 * boolean (arduino-cli's status, or the runtime's `/api/compilation-status`
 * exit_code by way of `deployRuntimeProgram`). It is now carried on the
 * terminal `closePort` message, and it wins.
 *
 * `hasError` survives as a fallback for a transport that can only observe the
 * channel closing — the CLI synthesises `closePort` from the socket's close
 * event, with no verdict to attach (see cli-transport.ts).
 */

import type { BoardInfo, CompileProgressEvent, PLCProjectData } from '../../../shared/ports/types'
import { compileProgramFlow, type CompileProgramTransport } from '../compile-program-flow'

const projectData: PLCProjectData = {
  dataTypes: [],
  pous: [
    {
      name: 'main',
      pouType: 'program',
      interface: {
        variables: [
          {
            name: 'x',
            class: 'local',
            type: { definition: 'base-type', value: 'BOOL' },
            location: '',
            documentation: '',
          },
        ],
      },
      body: { language: 'st', value: 'x := TRUE;' },
      documentation: '',
    },
  ],
  // `configurations`, plural. The removed `as unknown as PLCProjectData` was
  // hiding a fixture keyed `configuration` — the backend zod type's name, not
  // this port type's — so the object never matched the type it claimed to be.
  configurations: {
    resource: {
      tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
      instances: [{ name: 'instance0', program: 'main', task: 'task0' }],
      globalVariables: [],
    },
  },
}

const boards = new Map<string, BoardInfo>([
  // A complete BoardInfo rather than an asserted partial. Only `core` and
  // `compiler` are read on this path, but `preview` and `specs` are required by
  // the type, and filling them is cheaper than a cast that would also hide the
  // day a genuinely required field appears.
  ['Test Board', { core: 'arduino:avr', compiler: 'arduino-cli', preview: '', specs: {} }],
])

/**
 * Run the flow, feeding it a scripted message stream, and return what it
 * resolved to. `messages` is delivered in order as soon as the flow subscribes.
 */
async function runWith(messages: Array<Record<string, unknown>>) {
  const events: CompileProgressEvent[] = []
  const transport: CompileProgramTransport = {
    getAvailableBoards: async () => boards,
    loadAllLibraries: async () => [],
    runCompileProgram: (_args, onMessage) => {
      for (const message of messages) onMessage(message)
    },
  }

  const result = await compileProgramFlow(
    { projectData, boardTarget: 'Test Board', projectPath: '/tmp/project' },
    transport,
    (event) => events.push(event),
  )
  return { result, events }
}

const ERROR_LINE = { message: "foo.cpp:1:1: warning: unused variable 'tmp'", logLevel: 'error' }

describe('compileProgramFlow — the verdict decides, not the log level', () => {
  it('succeeds on a positive verdict even though a line arrived at error level', async () => {
    // The regression. Without the verdict this resolved `success: false` with
    // the error line as its message.
    const { result } = await runWith([ERROR_LINE, { closePort: true, success: true }])

    expect(result.success).toBe(true)
  })

  it('fails on a negative verdict even though nothing was logged at error level', async () => {
    // The mirror case: a step that failed on its exit code without printing a
    // diagnostic. Inferring from the log would have called this a success.
    const { result } = await runWith([
      { message: 'Compiling...', logLevel: 'info' },
      { closePort: true, success: false },
    ])

    expect(result.success).toBe(false)
  })

  it('explains a failure whose only evidence is the verdict', async () => {
    // `lastError` is empty here, and an empty error string reads as "no reason
    // given" to every caller that surfaces it.
    const { result } = await runWith([{ closePort: true, success: false }])

    expect(result).toEqual({ success: false, error: 'Compilation failed' })
  })

  it('still reports the logged error when the verdict agrees with it', async () => {
    const { result } = await runWith([
      { message: 'foo.cpp:9:1: error: expected ";"', logLevel: 'error' },
      { closePort: true, success: false },
    ])

    expect(result).toEqual({ success: false, error: 'foo.cpp:9:1: error: expected ";"' })
  })

  it('falls back to the log level when the transport sends no verdict', async () => {
    // A transport that only sees the channel close cannot supply one.
    const withError = await runWith([ERROR_LINE, { closePort: true }])
    const withoutError = await runWith([{ message: 'Compiling...', logLevel: 'info' }, { closePort: true }])

    expect(withError.result.success).toBe(false)
    expect(withoutError.result.success).toBe(true)
  })

  it('announces completion only when the build actually succeeded', async () => {
    const passed = await runWith([ERROR_LINE, { closePort: true, success: true }])
    const failed = await runWith([{ closePort: true, success: false }])

    expect(passed.events.some((e) => e.stage === 'done' && e.message === 'Compilation complete')).toBe(true)
    expect(failed.events.some((e) => e.stage === 'done')).toBe(false)
  })

  it('ignores a second terminal message, so a synthesised close cannot overturn the verdict', async () => {
    // The CLI posts `{closePort: true}` from the socket's close event AFTER the
    // backend's own verdict has already arrived. Without the `settled` guard
    // that second message would re-resolve from `hasError` — reintroducing the
    // bug on exactly the path that reported it.
    const { result } = await runWith([ERROR_LINE, { closePort: true, success: true }, { closePort: true }])

    expect(result.success).toBe(true)
  })
})
