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

/**
 * `hasEdgeAccount` is declared, not left off. The shared save path asks it to
 * decide whether a session that ended can be signed back into, and the desktop
 * always has an account surface. Nothing here exercises that branch today, but a
 * fixture that omits the field would send a future case down the wrong one.
 */
const capabilities = { isNativeApplication: true, hasEdgeAccount: true } as PlatformCapabilities

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

    describe('.dt persistence', () => {
      const savedFiles = (port: ProjectPort) => vi.mocked(port.saveProject).mock.calls[0][0]

      it('writes every data type to its own .dt file and never queues it for deletion', async () => {
        openPLCStoreBase.getState().datatypeActions.create({ name: 'Motor', derivation: 'structure' })
        openPLCStoreBase.getState().datatypeActions.create({ name: 'Colors', derivation: 'enumerated' })

        const projectPort = makeProjectPort()
        await executeSaveProject(projectPort, capabilities)

        expect(savedFiles(projectPort).deletions).not.toContain('datatypes/Motor.dt')
        expect(savedFiles(projectPort).dataTypeFiles).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ relativePath: 'datatypes/Motor.dt' }),
            expect.objectContaining({ relativePath: 'datatypes/Colors.dt' }),
          ]),
        )
      })

      it('echoes an unparseable .dt file back instead of dropping it', async () => {
        openPLCStoreBase
          .getState()
          .projectActions.setUnparsedDataTypeFiles([{ relativePath: 'datatypes/Broken.dt', content: 'TYPE not valid' }])

        const projectPort = makeProjectPort()
        await executeSaveProject(projectPort, capabilities)

        expect(savedFiles(projectPort).deletions).not.toContain('datatypes/Broken.dt')
        expect(savedFiles(projectPort).dataTypeFiles).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ relativePath: 'datatypes/Broken.dt', content: 'TYPE not valid' }),
          ]),
        )
      })

      it('leaves project.json carrying no data types', async () => {
        openPLCStoreBase.getState().datatypeActions.create({ name: 'Motor', derivation: 'structure' })

        const projectPort = makeProjectPort()
        await executeSaveProject(projectPort, capabilities)

        expect(JSON.parse(savedFiles(projectPort).projectJson).data.dataTypes).toEqual([])
      })

      // The filter is deliberately generalised beyond data types, so pin the
      // element type that has carried the same exposure the longest.
      it('does not delete a POU file this same save is writing', async () => {
        const { pouActions } = openPLCStoreBase.getState()
        pouActions.create({ type: 'program', name: 'Recreated', language: 'st' })
        openPLCStoreBase.getState().pouActions.delete('Recreated')
        openPLCStoreBase.getState().pouActions.create({ type: 'program', name: 'Recreated', language: 'st' })

        const projectPort = makeProjectPort()
        await executeSaveProject(projectPort, capabilities)

        const written: string[] = savedFiles(projectPort).pouFiles.map((f: { relativePath: string }) => f.relativePath)
        const deletions: string[] = savedFiles(projectPort).deletions
        expect(written.some((path) => path.endsWith('Recreated.st'))).toBe(true)
        expect(deletions.filter((path) => path.endsWith('Recreated.st'))).toEqual([])
      })

      // macOS and Windows treat these as one file, so an exact-string filter
      // would write the new name and then unlink it under the old one.
      it('does not delete a path that differs from a written one only by case', async () => {
        openPLCStoreBase.getState().datatypeActions.create({ name: 'Recased', derivation: 'structure' })
        openPLCStoreBase.getState().datatypeActions.delete('Recased')
        openPLCStoreBase.getState().datatypeActions.create({ name: 'recased', derivation: 'structure' })

        const projectPort = makeProjectPort()
        await executeSaveProject(projectPort, capabilities)

        expect(savedFiles(projectPort).deletions).not.toContain('datatypes/Recased.dt')
        expect(savedFiles(projectPort).dataTypeFiles).toEqual(
          expect.arrayContaining([expect.objectContaining({ relativePath: 'datatypes/recased.dt' })]),
        )
      })

      it('does not delete a .dt file this same save is writing', async () => {
        // `createDatatype` does not clear the entry `deleteDatatype` queued, and
        // both platforms apply deletions after the writes — so without the
        // payload filter this save would unlink the type it just wrote.
        openPLCStoreBase.getState().datatypeActions.create({ name: 'Motor', derivation: 'structure' })
        openPLCStoreBase.getState().datatypeActions.delete('Motor')
        openPLCStoreBase.getState().datatypeActions.create({ name: 'Motor', derivation: 'structure' })

        const projectPort = makeProjectPort()
        await executeSaveProject(projectPort, capabilities)

        expect(savedFiles(projectPort).deletions).not.toContain('datatypes/Motor.dt')
        expect(savedFiles(projectPort).dataTypeFiles).toEqual(
          expect.arrayContaining([expect.objectContaining({ relativePath: 'datatypes/Motor.dt' })]),
        )
      })
    })
  })

  describe('executeSaveFile', () => {
    // A single-file save that writes one `.dt` while project.json still carries
    // the inline list leaves the two halves disagreeing. Migrate the whole set.
    describe('.dt migration of a pre-DOPE-385 project', () => {
      const savedPaths = (port: ProjectPort) => vi.mocked(port.saveFile).mock.calls.map((c) => c[0])

      beforeEach(() => {
        const state = openPLCStoreBase.getState()
        state.datatypeActions.create({ name: 'MigEdited', derivation: 'structure' })
        state.datatypeActions.create({ name: 'MigUntouched', derivation: 'enumerated' })
        // The single-file save resolves its target through the file registry,
        // which the project tree populates in the running app.
        state.fileActions.addFile({ name: 'MigEdited', type: 'data-type', filePath: 'MigEdited' })
      })

      it('writes every .dt and rewrites project.json when the project still owes a migration', async () => {
        openPLCStoreBase.getState().projectActions.setDataTypesNeedMigration(true)

        const projectPort = makeProjectPort()
        const result = await executeSaveFile('MigEdited', projectPort, capabilities)

        expect(result.success).toBe(true)
        const paths: string[] = savedPaths(projectPort)
        expect(paths.some((p) => p.endsWith('MigEdited.dt'))).toBe(true)
        // The type the user did NOT save still has to reach disk, or reopening
        // the project would drop it.
        expect(paths.some((p) => p.endsWith('MigUntouched.dt'))).toBe(true)
        // project.json goes last so a failed .dt write leaves the inline list intact.
        expect(paths[paths.length - 1].endsWith('project.json')).toBe(true)
        const lastCall = vi.mocked(projectPort.saveFile).mock.calls.at(-1)
        const projectJson: string = typeof lastCall?.[1] === 'string' ? lastCall[1] : '{}'
        expect(JSON.parse(projectJson)).toMatchObject({ data: { dataTypes: [] } })
        expect(openPLCStoreBase.getState().dataTypesNeedMigration).toBe(false)
      })

      // `recordSavedFiles` tracks what is now on disk. Recording only the edited
      // type would leave the other migrated files looking dirty forever.
      it('records every migrated file with version control, not just the edited one', async () => {
        openPLCStoreBase.getState().projectActions.setDataTypesNeedMigration(true)

        await executeSaveFile('MigEdited', makeProjectPort(), capabilities)

        const recorded = Object.keys(openPLCStoreBase.getState().versionControl.rawLoadedContent)
        expect(recorded).toEqual(
          expect.arrayContaining(['datatypes/MigEdited.dt', 'datatypes/MigUntouched.dt', 'project.json']),
        )
      })

      it('writes only the edited .dt once the project has already migrated', async () => {
        openPLCStoreBase.getState().projectActions.setDataTypesNeedMigration(false)

        const projectPort = makeProjectPort()
        await executeSaveFile('MigEdited', projectPort, capabilities)

        const paths: string[] = savedPaths(projectPort)
        expect(paths).toHaveLength(1)
        expect(paths[0].endsWith('MigEdited.dt')).toBe(true)
      })

      it('leaves the migration owed when a .dt write fails', async () => {
        openPLCStoreBase.getState().projectActions.setDataTypesNeedMigration(true)

        const projectPort = makeProjectPort()
        vi.mocked(projectPort.saveFile).mockResolvedValue({ success: false, error: 'disk full' })
        const result = await executeSaveFile('MigEdited', projectPort, capabilities)

        expect(result.success).toBe(false)
        expect(openPLCStoreBase.getState().dataTypesNeedMigration).toBe(true)
      })
    })

    // An unreadable .dt still gets a tab and a code view, so Ctrl+S on it is a
    // realistic action now that every project carries .dt files.
    it('names the real problem when an unparseable .dt cannot be saved', async () => {
      openPLCStoreBase
        .getState()
        .projectActions.setUnparsedDataTypeFiles([{ relativePath: 'datatypes/Broken.dt', content: 'TYPE bad' }])
      openPLCStoreBase.getState().fileActions.addFile({ name: 'Broken', type: 'data-type', filePath: 'Broken' })

      const projectPort = makeProjectPort()
      const result = await executeSaveFile('Broken', projectPort, capabilities)

      expect(result.success).toBe(false)
      expect(projectPort.saveFile).not.toHaveBeenCalled()
      expect(lastToast()?.description).toContain('could not be parsed')
      expect(lastToast()?.variant).toBe('fail')
    })

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

/**
 * A retrieved project has no location the user chose: it sits in a scratch
 * directory the app prunes behind them. Both save entry points must refuse and
 * say so, rather than writing there and reporting success.
 *
 * Untested until now, which is how a refactor that stopped marking retrieved
 * projects at all reached a user: the save silently wrote to scratch and showed
 * nothing, because on the desktop a successful save is silent.
 */
describe('a project with no location the user chose', () => {
  beforeEach(() => {
    openPLCStoreBase.getState().workspaceActions.setIsEphemeralProject(true)
  })

  afterEach(() => {
    openPLCStoreBase.getState().workspaceActions.setIsEphemeralProject(false)
  })

  it('refuses Save Project and points at Save As', async () => {
    const port = makeProjectPort()

    const result = await executeSaveProject(port, capabilities)

    expect(result).toEqual({ success: false })
    expect(port.saveProject).not.toHaveBeenCalled()
    expect(lastToast()?.title).toBe('This project has no location yet')
  })

  it('refuses Save File too — one file lands in the same temporary place', async () => {
    createLadderPou('ScratchPou')
    const port = makeProjectPort()

    const result = await executeSaveFile('ScratchPou', port, capabilities)

    expect(result).toEqual({ success: false })
    expect(port.saveFile).not.toHaveBeenCalled()
    expect(lastToast()?.title).toBe('This project has no location yet')
  })

  it('still lets the build flush the tree it has to compile from', async () => {
    const port = makeProjectPort()

    const result = await executeSaveProject(port, capabilities, 'pre-build')

    expect(result.success).toBe(true)
    expect(port.saveProject).toHaveBeenCalled()
  })
})
