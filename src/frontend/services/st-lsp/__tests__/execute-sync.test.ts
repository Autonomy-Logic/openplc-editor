import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { getBodyLineOffset } from '../../lsp-shared/body-offsets'

// The store is a module-level singleton in the real app; stub it so the sync
// layer can be driven directly.
const state: {
  project: { data: { pous: PLCPou[] } }
  ladderFlows: unknown[]
  fbdFlows: unknown[]
  projectActions: { getAliasIndex: () => ReadonlyMap<string, string> }
} = {
  project: { data: { pous: [] } },
  ladderFlows: [],
  fbdFlows: [],
  projectActions: { getAliasIndex: () => new Map() },
}

jest.mock('../../../store', () => ({
  openPLCStoreBase: {
    getState: () => state,
    subscribe: () => () => {},
  },
}))

// eslint-disable-next-line import/first -- must follow the store mock
import { attachExecuteSync, collectExecuteDocs, getExecuteDraftApi } from '../execute-sync'

function makePou(name: string): PLCPou {
  return {
    name,
    pouType: 'program',
    interface: {
      variables: [
        {
          id: '1',
          name: 'counter',
          class: 'local',
          type: { definition: 'base-type', value: 'INT' },
          location: '',
          documentation: '',
          debug: false,
        },
      ],
    },
    body: { language: 'ld', value: { rungs: [] } },
  } as unknown as PLCPou
}

function makeService() {
  return {
    ready: Promise.resolve(),
    refreshStlibs: jest.fn(),
    openDocument: jest.fn(),
    changeDocument: jest.fn(),
    closeDocument: jest.fn(),
    dispose: jest.fn(),
  }
}

const EXECUTE_URI = 'inmemory://execute/main/EXECUTE_1.st'

beforeEach(() => {
  state.project.data.pous = [makePou('main')]
  state.ladderFlows = []
  state.fbdFlows = []
})

describe('collectExecuteDocs', () => {
  it('finds Execute nodes across ladder and FBD flows', () => {
    state.ladderFlows = [
      { name: 'main', rungs: [{ nodes: [{ id: 'X', type: 'execute', data: { code: 'counter := 1;' } }] }] },
    ]
    state.fbdFlows = [
      { name: 'main', rung: { nodes: [{ id: 'Y', type: 'execute', data: { code: 'counter := 2;' } }] } },
    ]

    const docs = collectExecuteDocs(state as never)

    expect(docs.map((d) => d.uri)).toEqual(['inmemory://execute/main/X.st', 'inmemory://execute/main/Y.st'])
  })

  it('skips empty snippets and nodes whose POU is gone', () => {
    state.ladderFlows = [
      {
        name: 'main',
        rungs: [
          {
            nodes: [
              { id: 'A', type: 'execute', data: { code: '   ' } },
              { id: 'B', type: 'coil', data: {} },
            ],
          },
        ],
      },
      { name: 'deleted-pou', rungs: [{ nodes: [{ id: 'C', type: 'execute', data: { code: 'x := 1;' } }] }] },
    ]

    expect(collectExecuteDocs(state as never)).toEqual([])
  })
})

describe('live draft channel', () => {
  // Regression: diagnostics used to be driven only off the store, which learns
  // the snippet on blur. By then the field is often deselected and its Monaco
  // model disposed, so markers had nowhere to land — a bad identifier surfaced
  // only at compile time, which is exactly what this element exists to avoid.
  it('publishes a draft immediately, without waiting for a store commit', () => {
    const service = makeService()
    const handle = attachExecuteSync(service as never)

    getExecuteDraftApi()?.syncDraft(EXECUTE_URI, 'counter := notAVariable + 1;')

    expect(service.openDocument).toHaveBeenCalledTimes(1)
    const [uri, text] = service.openDocument.mock.calls[0] as [string, string]
    expect(uri).toBe(EXECUTE_URI)
    // The snippet is wrapped in a shell carrying the POU's declarations, so
    // strucpp resolves `counter` and flags `notAVariable`.
    expect(text).toContain('counter : INT;')
    expect(text).toContain('counter := notAVariable + 1;')

    handle.dispose()
  })

  it('records a body offset that points at the snippet, not the preamble', () => {
    const service = makeService()
    const handle = attachExecuteSync(service as never)

    getExecuteDraftApi()?.syncDraft(EXECUTE_URI, 'counter := 1;')

    const [, text] = service.openDocument.mock.calls[0] as [string, string]
    const offset = getBodyLineOffset(EXECUTE_URI)
    // A diagnostic the worker reports on `offset + 1` must map to snippet
    // line 1; get this wrong and every squiggle lands on the wrong line.
    expect(text.split('\n')[offset]).toBe('counter := 1;')

    handle.dispose()
  })

  it('sends didChange for an edit and nothing at all for an unchanged draft', () => {
    const service = makeService()
    const handle = attachExecuteSync(service as never)

    getExecuteDraftApi()?.syncDraft(EXECUTE_URI, 'counter := 1;')
    getExecuteDraftApi()?.syncDraft(EXECUTE_URI, 'counter := 1;')
    getExecuteDraftApi()?.syncDraft(EXECUTE_URI, 'counter := 2;')

    expect(service.openDocument).toHaveBeenCalledTimes(1)
    expect(service.changeDocument).toHaveBeenCalledTimes(1)

    handle.dispose()
  })

  it('ignores URIs that are not Execute documents, and unknown POUs', () => {
    const service = makeService()
    const handle = attachExecuteSync(service as never)

    getExecuteDraftApi()?.syncDraft('inmemory://pou/main.st', 'counter := 1;')
    getExecuteDraftApi()?.syncDraft('inmemory://execute/nope/X.st', 'counter := 1;')

    expect(service.openDocument).not.toHaveBeenCalled()

    handle.dispose()
  })

  it('is null once disposed, so callers degrade instead of throwing', () => {
    const handle = attachExecuteSync(makeService() as never)
    expect(getExecuteDraftApi()).not.toBeNull()

    handle.dispose()

    expect(getExecuteDraftApi()).toBeNull()
  })
  // Regression: `openDocument` sets version 1, and this layer used to pass its
  // own counter — which also started at 1 — so the first edit collided and the
  // worker silently dropped it. `start-language-service` documents that exact
  // trap at its `changeDocument`. Omitting the version lets the service
  // auto-increment, which is correct by construction.
  it('never supplies its own document version', () => {
    const service = makeService()
    const handle = attachExecuteSync(service as never)

    getExecuteDraftApi()?.syncDraft(EXECUTE_URI, 'counter := 1;')
    getExecuteDraftApi()?.syncDraft(EXECUTE_URI, 'counter := 2;')
    getExecuteDraftApi()?.syncDraft(EXECUTE_URI, 'counter := 3;')

    for (const call of service.changeDocument.mock.calls) {
      expect(call).toHaveLength(2)
    }

    handle.dispose()
  })

  // Regression: diagnostics are a one-shot notification, so markers land only
  // on the model that exists when they arrive. Opening the expand modal builds
  // a fresh model at the same URI with unchanged text — without a forced
  // re-analyse the worker stays silent and that model shows no squiggles.
  it('re-publishes unchanged text when forced, so a newly mounted model gets markers', () => {
    const service = makeService()
    const handle = attachExecuteSync(service as never)

    getExecuteDraftApi()?.syncDraft(EXECUTE_URI, 'counter := 1;')
    expect(service.changeDocument).not.toHaveBeenCalled()

    // Same text, no force — nothing to say.
    getExecuteDraftApi()?.syncDraft(EXECUTE_URI, 'counter := 1;')
    expect(service.changeDocument).not.toHaveBeenCalled()

    // Same text, forced — the worker must re-analyse and re-publish.
    getExecuteDraftApi()?.syncDraft(EXECUTE_URI, 'counter := 1;', true)
    expect(service.changeDocument).toHaveBeenCalledTimes(1)

    handle.dispose()
  })
})
