/**
 * save-actions.ts test file
 *
 * The pure helpers these functions delegate to (sanitizePou,
 * collectDebugVariables, serializePouToText, …) are covered by their own
 * suites. The cases below drive the real store singleton to pin the DOPE-495
 * contract: a graphical flow that fails schema validation keeps a stale
 * `pou.body.value`, so it must never be reported as saved.
 */

import type { PlatformCapabilities } from '../../../middleware/shared/ports/platform-capabilities'
import type { ProjectPort } from '../../../middleware/shared/ports/project-port'
import { openPLCStoreBase } from '../../store'
import type { LadderFlowType } from '../../store/slices/ladder'
import { getMemoryState } from '../../utils/toast'
import { buildAllProjectFileContentsPure, executeSaveFile, executeSaveProject } from '../save-actions'

const capabilities = { isNativeApplication: true } as PlatformCapabilities

const lastToast = () => getMemoryState().toasts[0]

function makeProjectPort(): ProjectPort {
  return {
    saveProject: vi.fn().mockResolvedValue({ success: true }),
    saveFile: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as ProjectPort
}

function createLadderPou(name: string) {
  const state = openPLCStoreBase.getState()
  state.pouActions.create({ type: 'program', name, language: 'ld' })
  state.ladderFlowActions.startLadderRung({
    editorName: name,
    rungId: `rung_${name}_1`,
    defaultBounds: [300, 100],
    reactFlowViewport: [300, 100],
  })
  state.ladderFlowActions.setFlowUpdated({ editorName: name, updated: true })
}

/** Drop `defaultBounds` / `reactFlowViewport` so the flow fails the zod guard. */
function corruptFlow(name: string) {
  const flow = openPLCStoreBase.getState().ladderFlows.find((f) => f.name === name)
  openPLCStoreBase.getState().ladderFlowActions.addLadderFlow({
    name,
    updated: true,
    rungs: (flow?.rungs ?? []).map((rung) => ({ id: rung.id, comment: '', nodes: [], edges: [] })),
  } as unknown as LadderFlowType)
  openPLCStoreBase.getState().ladderFlowActions.setFlowUpdated({ editorName: name, updated: true })
}

const flowUpdated = (name: string) => openPLCStoreBase.getState().ladderFlows.find((f) => f.name === name)?.updated
const fileSaved = (name: string) => openPLCStoreBase.getState().files[name]?.saved

describe('save-actions', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    openPLCStoreBase.getState().ladderFlowActions.clearLadderFlows()
  })

  afterEach(() => {
    warn.mockRestore()
  })

  describe('executeSaveProject', () => {
    describe('a project retrieved from a device', () => {
      // It lives in a scratch directory until the user picks a location.
      // Writing there and reporting success would tell someone their work is
      // safe when it is somewhere temporary.
      afterEach(() => {
        openPLCStoreBase.getState().workspaceActions.setIsEphemeralProject(false)
      })

      it('refuses a user save and says what to do instead', async () => {
        openPLCStoreBase.getState().workspaceActions.setIsEphemeralProject(true)
        const projectPort = makeProjectPort()

        const result = await executeSaveProject(projectPort, capabilities)

        expect(result.success).toBe(false)
        expect(projectPort.saveProject).not.toHaveBeenCalled()
        expect(lastToast()).toMatchObject({ title: 'This project has no location yet' })
      })

      it('still lets the build flush the project to disk', async () => {
        // The compiler reads its source from disk, so refusing this would not
        // protect the project -- it would stop it compiling. This is the whole
        // reason the two saves are distinguishable.
        openPLCStoreBase.getState().workspaceActions.setIsEphemeralProject(true)
        const projectPort = makeProjectPort()

        const result = await executeSaveProject(projectPort, capabilities, 'pre-build')

        expect(result.success).toBe(true)
        expect(projectPort.saveProject).toHaveBeenCalled()
      })

      it('leaves an ordinary project untouched', async () => {
        const projectPort = makeProjectPort()
        const result = await executeSaveProject(projectPort, capabilities)
        expect(result.success).toBe(true)
        expect(projectPort.saveProject).toHaveBeenCalled()
      })
    })

    it('reports success and clears the updated flag for a valid flow', async () => {
      createLadderPou('ValidPou')

      const result = await executeSaveProject(makeProjectPort(), capabilities)

      expect(result.success).toBe(true)
      expect(flowUpdated('ValidPou')).toBe(false)
    })

    it('does not report a POU as saved when its flow fails validation', async () => {
      createLadderPou('BrokenPou')
      corruptFlow('BrokenPou')

      const result = await executeSaveProject(makeProjectPort(), capabilities)

      expect(result.success).toBe(false)
      // Keeping `updated` set is what lets a later edit retry the write-back.
      expect(flowUpdated('BrokenPou')).toBe(true)
      expect(fileSaved('BrokenPou')).toBe(false)
      expect(lastToast()).toMatchObject({ title: 'Some changes were not saved', variant: 'fail' })
    })

    it('still saves the valid POUs alongside a failing one', async () => {
      createLadderPou('GoodPou')
      createLadderPou('BadPou')
      corruptFlow('BadPou')

      const projectPort = makeProjectPort()
      const result = await executeSaveProject(projectPort, capabilities)

      expect(result.success).toBe(false)
      expect(projectPort.saveProject).toHaveBeenCalled()
      expect(flowUpdated('GoodPou')).toBe(false)
      expect(fileSaved('GoodPou')).toBe(true)
    })

    it('stops blocking saves once the POU behind an invalid flow is deleted', async () => {
      createLadderPou('Doomed')
      corruptFlow('Doomed')
      createLadderPou('Healthy')

      expect((await executeSaveProject(makeProjectPort(), capabilities)).success).toBe(false)

      // Deleting the POU is the user's only escape hatch, and it leaves the
      // flow behind — the save must stop reporting it.
      openPLCStoreBase.getState().pouActions.delete('Doomed')

      const result = await executeSaveProject(makeProjectPort(), capabilities)

      expect(result.success).toBe(true)
      expect(fileSaved('Healthy')).toBe(true)
    })

    // Hydration prefers `.dt` files whenever they exist, so a rollback save
    // that left them on disk would let a pre-rollback copy outrank the legacy
    // JSON the next time the flag is on.
    describe('.dt cleanup on a flag-off save', () => {
      const savedFiles = (port: ProjectPort) => vi.mocked(port.saveProject).mock.calls[0][0]

      it('queues the .dt file of every data type for deletion', async () => {
        openPLCStoreBase.getState().datatypeActions.create({ name: 'Motor', derivation: 'structure' })
        openPLCStoreBase.getState().datatypeActions.create({ name: 'Colors', derivation: 'enumerated' })

        const projectPort = makeProjectPort()
        await executeSaveProject(projectPort, capabilities)

        expect(savedFiles(projectPort).deletions).toEqual(
          expect.arrayContaining(['datatypes/Motor.dt', 'datatypes/Colors.dt']),
        )
        expect(savedFiles(projectPort).dataTypeFiles).toEqual([])
      })

      it('queues an unparseable .dt file too', async () => {
        openPLCStoreBase
          .getState()
          .projectActions.setUnparsedDataTypeFiles([{ relativePath: 'datatypes/Broken.dt', content: 'TYPE not valid' }])

        const projectPort = makeProjectPort()
        await executeSaveProject(projectPort, capabilities)

        expect(savedFiles(projectPort).deletions).toContain('datatypes/Broken.dt')
      })

      it('leaves the .dt files alone when the write side is on', async () => {
        const flags = await import('../../utils/feature-flags')
        vi.spyOn(flags, 'isDataTypeFilesEnabled').mockReturnValue(true)
        openPLCStoreBase.getState().datatypeActions.create({ name: 'Motor', derivation: 'structure' })

        const projectPort = makeProjectPort()
        await executeSaveProject(projectPort, capabilities)

        expect(savedFiles(projectPort).deletions).not.toContain('datatypes/Motor.dt')
        expect(savedFiles(projectPort).dataTypeFiles).toEqual(
          expect.arrayContaining([expect.objectContaining({ relativePath: 'datatypes/Motor.dt' })]),
        )
      })

      it('does not repeat a path the store already queued', async () => {
        openPLCStoreBase.getState().datatypeActions.create({ name: 'Motor', derivation: 'structure' })
        openPLCStoreBase.getState().datatypeActions.delete('Motor')
        openPLCStoreBase.getState().datatypeActions.create({ name: 'Motor', derivation: 'structure' })

        const projectPort = makeProjectPort()
        await executeSaveProject(projectPort, capabilities)

        const deletions: string[] = savedFiles(projectPort).deletions
        expect(deletions.filter((d) => d === 'datatypes/Motor.dt')).toHaveLength(1)
      })
    })
  })

  describe('executeSaveFile', () => {
    it('refuses to write the stale body of a failing flow', async () => {
      createLadderPou('BrokenFile')
      corruptFlow('BrokenFile')

      const projectPort = makeProjectPort()
      const result = await executeSaveFile('BrokenFile', projectPort, capabilities)

      expect(result.success).toBe(false)
      expect(projectPort.saveFile).not.toHaveBeenCalled()
      expect(flowUpdated('BrokenFile')).toBe(true)
    })

    it('writes a valid flow normally', async () => {
      createLadderPou('ValidFile')

      const projectPort = makeProjectPort()
      const result = await executeSaveFile('ValidFile', projectPort, capabilities)

      expect(result.success).toBe(true)
      expect(projectPort.saveFile).toHaveBeenCalled()
      expect(flowUpdated('ValidFile')).toBe(false)
    })

    it('leaves an unrelated failing POU untouched', async () => {
      createLadderPou('TargetFile')
      createLadderPou('Unrelated')
      corruptFlow('Unrelated')

      const projectPort = makeProjectPort()
      const result = await executeSaveFile('TargetFile', projectPort, capabilities)

      expect(result.success).toBe(true)
      expect(projectPort.saveFile).toHaveBeenCalled()
      // The flush is scoped to the target, so the unrelated flow is never
      // validated and never warns.
      expect(warn).not.toHaveBeenCalled()
      expect(flowUpdated('Unrelated')).toBe(true)
    })
  })
})

/**
 * `project.json` is a field-by-field object, so anything not named in it is dropped from
 * the saved project however well it lives in the store. A Global Variable List has no
 * file of its own — this IS its persistence — so the omission cost every list on every
 * save, silently, and reopening the project showed none of them.
 *
 * These cases exist to make the next field added to that object fail loudly instead.
 */
describe('project.json carries global variable lists', () => {
  const createList = (name: string, members: string[]) => {
    const state = openPLCStoreBase.getState()
    state.projectActions.createGlobalVariableList(name)
    state.projectActions.updateGlobalVariableList(
      name,
      members.map((member) => ({
        name: member,
        class: 'global' as const,
        type: { definition: 'base-type' as const, value: 'BOOL' },
        location: '',
        initialValue: '',
        documentation: '',
      })),
    )
  }

  it('serializes a list and its members into project.json', () => {
    createList('SaveProbe', ['ProbeMember'])

    const payload = buildAllProjectFileContentsPure()['project.json']

    expect(payload).toContain('SaveProbe')
    expect(payload).toContain('ProbeMember')
    expect(JSON.parse(payload).data.globalVariableLists).toHaveLength(1)
  })

  it('writes an empty array rather than omitting the field', () => {
    // A reader cannot tell "no lists" from "written by a build that did not know about
    // them" if the key is simply absent.
    const parsed = JSON.parse(buildAllProjectFileContentsPure()['project.json']) as {
      data: { globalVariableLists?: unknown }
    }

    expect(Array.isArray(parsed.data.globalVariableLists)).toBe(true)
  })

  it('folds a pending code-view buffer in before serializing', () => {
    // Ctrl+S with the caret still in Monaco fires no blur, so the list would otherwise
    // be serialized as it was before the user started typing.
    // Through the shared action, so the list gets the editor model that holds the draft.
    openPLCStoreBase.getState().globalVariableListActions.create('DraftProbe')
    openPLCStoreBase.getState().editorActions.updateModelStructureForName('DraftProbe', {
      display: 'code',
      code: 'VAR_GLOBAL\n  TypedMember : INT;\nEND_VAR\n',
    })

    const payload = buildAllProjectFileContentsPure()['project.json']

    expect(payload).toContain('TypedMember')
  })
})

/**
 * An unparseable declaration is written out as TEXT, never refused.
 *
 * Same contract a POU's unparseable variables block (`variablesText`) and an unreadable
 * `.dt` file already follow: the file is still saved, the text is preserved verbatim,
 * and it comes back in the code view to be corrected. Blocking the save is the one
 * outcome that loses the user's work.
 */
describe('an unparseable list declaration is saved as text', () => {
  const brokenDeclaration = 'VAR_GLOBAL\n  A : BOOL\nEND_VAR\n'

  // The store is a singleton and the suites above deliberately corrupt ladder
  // flows; a leftover stale flow would fail the save for reasons of its own.
  beforeEach(() => {
    openPLCStoreBase.getState().ladderFlowActions.clearLadderFlows()
  })

  const openWithBrokenText = (name: string) => {
    openPLCStoreBase.getState().globalVariableListActions.create(name)
    openPLCStoreBase
      .getState()
      .editorActions.updateModelStructureForName(name, { display: 'code', code: brokenDeclaration })
  }

  it('still reports the save as successful', async () => {
    openWithBrokenText('BrokenSave')

    const result = await executeSaveProject(makeProjectPort(), capabilities)

    expect(result.success).toBe(true)
  })

  it('writes the raw declaration into project.json', async () => {
    openWithBrokenText('BrokenPersist')
    await executeSaveProject(makeProjectPort(), capabilities)

    const payload = buildAllProjectFileContentsPure()['project.json']
    const saved = (
      JSON.parse(payload) as { data: { globalVariableLists: { name: string; text?: string }[] } }
    ).data.globalVariableLists.find((l) => l.name === 'BrokenPersist')

    expect(saved?.text).toBe(brokenDeclaration)
  })

  it('drops the preserved text once the declaration parses again', async () => {
    openWithBrokenText('BrokenThenFixed')
    await executeSaveProject(makeProjectPort(), capabilities)

    openPLCStoreBase.getState().editorActions.updateModelStructureForName('BrokenThenFixed', {
      display: 'code',
      code: 'VAR_GLOBAL\n  A : BOOL;\nEND_VAR\n',
    })
    await executeSaveProject(makeProjectPort(), capabilities)

    const list = openPLCStoreBase.getState().project.data.globalVariableLists?.find((l) => l.name === 'BrokenThenFixed')
    expect(list?.text).toBeUndefined()
    expect(list?.variables.map((v) => v.name)).toEqual(['A'])
  })
})
