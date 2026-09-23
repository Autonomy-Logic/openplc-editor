/** Drives the real store singleton; a flow that fails schema validation keeps a stale `pou.body.value`. */

import type { EdgeSessionState } from '../../../middleware/shared/ports/edge-account-port'
import type { PlatformCapabilities } from '../../../middleware/shared/ports/platform-capabilities'
import type { ProjectPort } from '../../../middleware/shared/ports/project-port'
import { openPLCStoreBase } from '../../store'
import type { LadderFlowType } from '../../store/slices/ladder'
import { getMemoryState } from '../../utils/toast'
import { hasSaveWaitingForSignIn, resetResumeSaveForTests } from '../resume-save-after-sign-in'
import {
  buildAllProjectFileContentsPure,
  executeSaveActiveFile,
  executeSaveFile,
  executeSaveProject,
  reloadPouFromDisk,
} from '../save-actions'

// hasEdgeAccount is explicit: omitting it would silently route a future case down the wrong branch.
const capabilities = { isNativeApplication: true, hasEdgeAccount: true } as PlatformCapabilities

const lastToast = () => getMemoryState().toasts[0]

function makeProjectPort(): ProjectPort {
  return {
    saveProject: vi.fn().mockResolvedValue({ success: true }),
    saveFile: vi.fn().mockResolvedValue({ success: true }),
    // What Save As asks for when a cloud write falls back to disk.
    pickPath: vi.fn().mockResolvedValue({ success: true, path: '/local/copy' }),
    trackRecentProject: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as ProjectPort
}

/** A session that is alive as far as the renewal layer knows — the write is what says otherwise. */
function liveSession(): EdgeSessionState {
  return {
    isExpired: () => false,
    isAbsent: () => false,
    onExpired: () => () => undefined,
    onRestored: () => () => undefined,
    markRestored: () => undefined,
  }
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

  /**
   * Ctrl+S on the start screen ran a real save. `editor.meta.name` is the
   * literal string 'available' while nothing is open — the union's "no editor"
   * case carries it as a placeholder — so the emptiness check passed and the
   * save went looking for a file by that name, reporting
   * `File "available" not found` on a screen with no project at all.
   */
  describe('executeSaveActiveFile', () => {
    let path: string

    beforeEach(() => {
      path = openPLCStoreBase.getState().project.meta.path
    })

    afterEach(() => {
      openPLCStoreBase.getState().projectActions.updateMetaPath(path)
    })

    it('says nothing at all on the start screen, where there is no project', async () => {
      openPLCStoreBase.getState().projectActions.updateMetaPath('')
      const before = getMemoryState().toasts.length

      const result = await executeSaveActiveFile(makeProjectPort(), capabilities)

      expect(result.success).toBe(false)
      // A stray keystroke is not a failed save: no toast, and nothing attempted.
      expect(getMemoryState().toasts.length).toBe(before)
    })

    it('does not mistake the placeholder editor for an open file', async () => {
      openPLCStoreBase.getState().projectActions.updateMetaPath('/some/project')
      const projectPort = makeProjectPort()

      const result = await executeSaveActiveFile(projectPort, capabilities)

      expect(result.success).toBe(false)
      expect(lastToast()).toMatchObject({ title: 'No file open' })
      // The old code reached the write and failed on a file called "available".
      expect(projectPort.saveFile).not.toHaveBeenCalled()
    })
  })

  describe('executeSaveProject', () => {
    describe('a project retrieved from a device', () => {
      // A retrieved project's scratch location isn't real; reporting success there would be a lie.
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
        // The compiler reads its source from disk, so refusing this would stop it compiling.
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

    // The write's own response says why it failed; the queue doesn't depend on renewal-layer expiry state.
    describe('a cloud write that did not land', () => {
      let previousPath: string

      beforeEach(() => {
        resetResumeSaveForTests(liveSession())
        previousPath = openPLCStoreBase.getState().project.meta.path
      })

      afterEach(() => {
        resetResumeSaveForTests()
        openPLCStoreBase.getState().projectActions.updateMetaPath(previousPath)
      })

      it('queues the save for sign-in when the write says the session is gone', async () => {
        const projectPort = makeProjectPort()
        vi.mocked(projectPort.saveProject).mockResolvedValue({ success: false, reason: 'signed-out' })

        const result = await executeSaveProject(projectPort, capabilities)

        expect(result.success).toBe(false)
        expect(hasSaveWaitingForSignIn()).toBe(true)
        expect(projectPort.pickPath).not.toHaveBeenCalled()
        expect(lastToast()).toMatchObject({ title: 'Not saved — your session ended', variant: 'fail' })
      })

      it('falls back to Save As on the desktop when Autonomy Edge cannot be reached', async () => {
        const projectPort = makeProjectPort()
        vi.mocked(projectPort.saveProject)
          .mockResolvedValueOnce({ success: false, reason: 'unreachable' })
          .mockResolvedValue({ success: true })

        const result = await executeSaveProject(projectPort, { ...capabilities, hasLocalFilesystem: true })

        expect(result.success).toBe(true)
        expect(projectPort.pickPath).toHaveBeenCalled()
        // The second write is the local copy, and the project now lives there.
        expect(vi.mocked(projectPort.saveProject).mock.calls[1][0].projectPath).toBe('/local/copy')
        expect(openPLCStoreBase.getState().project.meta.path).toBe('/local/copy')
        expect(hasSaveWaitingForSignIn()).toBe(false)
      })

      it('reports the failure on the web, which has no disk to fall back to', async () => {
        const projectPort = makeProjectPort()
        vi.mocked(projectPort.saveProject).mockResolvedValue({
          success: false,
          reason: 'unreachable',
          error: 'offline',
        })

        const result = await executeSaveProject(projectPort, { ...capabilities, hasLocalFilesystem: false })

        expect(result.success).toBe(false)
        expect(projectPort.pickPath).not.toHaveBeenCalled()
        expect(lastToast()).toMatchObject({ title: 'Error in the save request!', description: 'offline' })
      })

      it('reports a cancelled Save As as an unsaved project', async () => {
        const projectPort = makeProjectPort()
        vi.mocked(projectPort.saveProject).mockResolvedValue({ success: false, reason: 'unreachable' })
        vi.mocked(projectPort.pickPath).mockResolvedValue({ success: false })

        const result = await executeSaveProject(projectPort, { ...capabilities, hasLocalFilesystem: true })

        expect(result.success).toBe(false)
        expect(openPLCStoreBase.getState().workspace.editingState).toBe('unsaved')
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

      // Deleting the POU leaves the flow behind — the save must stop reporting it.
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

      // The filter is generalised beyond data types; this pins the longest-exposed case, a recreated POU file.
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

      // macOS/Windows treat these paths as one file; an exact-string filter would unlink the new write under the old name.
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
        // Deletions apply after writes on both platforms, so without the payload filter this would unlink the type it just wrote.
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
    // A single-file save must migrate the whole set, or project.json and the new .dt disagree.
    describe('.dt migration of a pre-DOPE-385 project', () => {
      const savedPaths = (port: ProjectPort) => vi.mocked(port.saveFile).mock.calls.map((c) => c[0])

      beforeEach(() => {
        const state = openPLCStoreBase.getState()
        state.datatypeActions.create({ name: 'MigEdited', derivation: 'structure' })
        state.datatypeActions.create({ name: 'MigUntouched', derivation: 'enumerated' })
        // The single-file save resolves its target through the file registry the project tree populates.
        state.fileActions.addFile({ name: 'MigEdited', type: 'data-type', filePath: 'MigEdited' })
      })

      it('writes every .dt and rewrites project.json when the project still owes a migration', async () => {
        openPLCStoreBase.getState().projectActions.setDataTypesNeedMigration(true)

        const projectPort = makeProjectPort()
        const result = await executeSaveFile('MigEdited', projectPort, capabilities)

        expect(result.success).toBe(true)
        const paths: string[] = savedPaths(projectPort)
        expect(paths.some((p) => p.endsWith('MigEdited.dt'))).toBe(true)
        // The type the user did NOT save still has to reach disk, or reopening the project would drop it.
        expect(paths.some((p) => p.endsWith('MigUntouched.dt'))).toBe(true)
        // project.json goes last so a failed .dt write leaves the inline list intact.
        expect(paths[paths.length - 1].endsWith('project.json')).toBe(true)
        const lastCall = vi.mocked(projectPort.saveFile).mock.calls.at(-1)
        const projectJson: string = typeof lastCall?.[1] === 'string' ? lastCall[1] : '{}'
        expect(JSON.parse(projectJson)).toMatchObject({ data: { dataTypes: [] } })
        expect(openPLCStoreBase.getState().dataTypesNeedMigration).toBe(false)
      })

      // `recordSavedFiles` must track every migrated file, or the untouched ones stay marked dirty forever.
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

    // An unreadable .dt still gets a tab and a code view, so Ctrl+S on it is a realistic action.
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

    describe('a cloud write that did not land', () => {
      let previousPath: string

      beforeEach(() => {
        resetResumeSaveForTests(liveSession())
        previousPath = openPLCStoreBase.getState().project.meta.path
      })

      afterEach(() => {
        resetResumeSaveForTests()
        openPLCStoreBase.getState().projectActions.updateMetaPath(previousPath)
      })

      it('queues the file for sign-in when the write says the session is gone', async () => {
        createLadderPou('CloudFile')
        const projectPort = makeProjectPort()
        vi.mocked(projectPort.saveFile).mockResolvedValue({ success: false, reason: 'signed-out' })

        const result = await executeSaveFile('CloudFile', projectPort, capabilities)

        expect(result.success).toBe(false)
        expect(hasSaveWaitingForSignIn()).toBe(true)
        expect(lastToast()?.description).toContain('"CloudFile" saves on its own')
      })

      it('falls back to Save As for the whole project on the desktop when Autonomy Edge cannot be reached', async () => {
        createLadderPou('OfflineFile')
        const projectPort = makeProjectPort()
        vi.mocked(projectPort.saveFile).mockResolvedValue({ success: false, reason: 'unreachable' })

        const result = await executeSaveFile('OfflineFile', projectPort, { ...capabilities, hasLocalFilesystem: true })

        expect(result.success).toBe(true)
        expect(projectPort.pickPath).toHaveBeenCalled()
        expect(projectPort.saveProject).toHaveBeenCalled()
        expect(hasSaveWaitingForSignIn()).toBe(false)
      })

      it('still names a plain write failure as one', async () => {
        createLadderPou('BrokenDisk')
        const projectPort = makeProjectPort()
        vi.mocked(projectPort.saveFile).mockResolvedValue({ success: false, error: 'disk full' })

        const result = await executeSaveFile('BrokenDisk', projectPort, { ...capabilities, hasLocalFilesystem: true })

        expect(result.success).toBe(false)
        expect(projectPort.pickPath).not.toHaveBeenCalled()
        expect(lastToast()).toMatchObject({ title: 'Error saving file', description: 'disk full' })
      })
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
      // The flush is scoped to the target, so the unrelated flow is never validated and never warns.
      expect(warn).not.toHaveBeenCalled()
      expect(flowUpdated('Unrelated')).toBe(true)
    })
  })
})

// project.json is built field-by-field; an omitted field silently drops that list (it has no file of its own).
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
    // A reader can't tell "no lists" from "an older build that didn't know about them" if the key is simply absent.
    const parsed = JSON.parse(buildAllProjectFileContentsPure()['project.json']) as {
      data: { globalVariableLists?: unknown }
    }

    expect(Array.isArray(parsed.data.globalVariableLists)).toBe(true)
  })

  it('folds a pending code-view buffer in before serializing', () => {
    // Ctrl+S with the caret still in Monaco fires no blur, so the list would otherwise serialize stale.
    openPLCStoreBase.getState().globalVariableListActions.create('DraftProbe')
    openPLCStoreBase.getState().editorActions.updateModelStructureForName('DraftProbe', {
      display: 'code',
      code: 'VAR_GLOBAL\n  TypedMember : INT;\nEND_VAR\n',
    })

    const payload = buildAllProjectFileContentsPure()['project.json']

    expect(payload).toContain('TypedMember')
  })
})

// An unparseable declaration is saved as text, never refused, matching a POU's unparseable variables block.
describe('an unparseable list declaration is saved as text', () => {
  const brokenDeclaration = 'VAR_GLOBAL\n  A : BOOL\nEND_VAR\n'

  // The store is a singleton; a stale corrupted flow left by an earlier suite would fail this save for unrelated reasons.
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

// A retrieved project sits in a scratch directory the app prunes; both save entry points must refuse and say so.
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

/**
 * A project saved before blocks wrote their library into `project.libraries`
 * still has the FB instances in its variables tables. On the side that has the
 * library installed, the save reads usage from those and writes the entry, so
 * the other side finally has something to warn about.
 */
describe('project.json libraries', () => {
  const POU = 'LibUsageProbe'

  beforeEach(() => {
    const state = openPLCStoreBase.getState()
    state.libraryActions.setSystemLibraries([
      { name: 'demo-utils', author: 'qa', version: '2.1.0', stPath: '', cPath: '', pous: [{ name: 'ANALOGSCALE' }] },
    ] as unknown as Parameters<typeof state.libraryActions.setSystemLibraries>[0])
    state.libraryActions.setBundledLibraryNames([])
    state.libraryActions.setProjectLibraries([])
    state.pouActions.create({ type: 'program', name: POU, language: 'st' })
    state.projectActions.createVariable({
      data: {
        id: 'v-scale',
        name: 'Scale0',
        type: { definition: 'derived', value: 'ANALOGSCALE' },
        class: 'local',
        location: '',
        documentation: '',
        debug: false,
      },
      scope: 'local',
      associatedPou: POU,
    })
  })

  afterEach(() => {
    openPLCStoreBase.getState().pouActions.delete(POU)
    openPLCStoreBase.getState().libraryActions.setProjectLibraries([])
  })

  it('writes the library an FB instance comes from, even when nothing declared it', () => {
    const parsed = JSON.parse(buildAllProjectFileContentsPure()['project.json']) as {
      data: { libraries: { name: string; version: string }[] }
    }

    expect(parsed.data.libraries).toEqual([{ name: 'demo-utils', version: '2.1.0' }])
  })

  it('keeps a declared entry as declared, without duplicating it', () => {
    openPLCStoreBase.getState().libraryActions.setProjectLibraries([{ name: 'demo-utils', version: '1.0.0' }])

    const parsed = JSON.parse(buildAllProjectFileContentsPure()['project.json']) as {
      data: { libraries: { name: string; version: string }[] }
    }

    // The declared version wins: the save fills gaps, it does not rewrite choices.
    expect(parsed.data.libraries).toEqual([{ name: 'demo-utils', version: '1.0.0' }])
  })
})

/**
 * Reloading a POU whose file changed outside the editor (DOPE-650).
 *
 * The file is the source of truth for the declarations, so a reload has to take
 * the file's own text. It used to restore only the variables and the body, and
 * the reclassify pass that follows then read the text the store was ALREADY
 * holding — so a comment or a re-indent made on disk was reverted on the next
 * save, silently.
 */
describe('reloadPouFromDisk', () => {
  const portReturning = (content: string): ProjectPort =>
    ({
      readFileContent: vi.fn().mockResolvedValue({ success: true, content }),
    }) as unknown as ProjectPort

  const seedTextualPou = (name: string, text: string) => {
    const state = openPLCStoreBase.getState()
    expect(state.pouActions.create({ type: 'program', name, language: 'st' }).ok).toBe(true)
    state.projectActions.setPouVariablesText(name, text)
    state.projectActions.setPouVariables({
      pouName: name,
      variables: [
        {
          name: 'a',
          class: 'local',
          type: { definition: 'base-type', value: 'INT' },
          location: '',
          documentation: '',
          debug: false,
        },
      ],
    })
  }

  const textOf = (name: string) =>
    openPLCStoreBase.getState().project.data.pous.find((pou) => pou.name === name)?.variablesText

  const openEditor = (name: string) =>
    openPLCStoreBase.getState().editorActions.addModel({
      type: 'plc-textual',
      meta: { name, path: `/pous/${name}`, language: 'st', pouType: 'program' },
      variable: { display: 'table', description: '', classFilter: 'All', selectedRow: '-1' },
    })

  it('takes the declaration text from the file, comments and all', async () => {
    seedTextualPou('Reloaded', 'VAR\n  a : INT;\nEND_VAR')
    const onDisk =
      'PROGRAM Reloaded\nVAR\n  (* renamed on disk *)\n  a : INT;\n  b : BOOL;\nEND_VAR\n\na := 1;\n\nEND_PROGRAM'

    await reloadPouFromDisk('Reloaded', portReturning(onDisk))

    expect(textOf('Reloaded')).toBe('VAR\n  (* renamed on disk *)\n  a : INT;\n  b : BOOL;\nEND_VAR')
    expect(
      openPLCStoreBase
        .getState()
        .project.data.pous.find((pou) => pou.name === 'Reloaded')
        ?.interface?.variables.map((variable) => variable.name),
    ).toEqual(['a', 'b'])
  })

  /**
   * The code view holds the pre-reload text and it parses, so the regenerate that
   * `applyPouSnapshot` triggers preferred it and patched it straight back over the
   * text just read from disk — reverting the external edit the reload exists to pick
   * up. The buffer is the user's newest word only while it is still theirs.
   */
  it('replaces an open code-view buffer with the text from disk', async () => {
    seedTextualPou('ReloadOpen', 'VAR\n  a : INT;\nEND_VAR')
    openEditor('ReloadOpen')
    openPLCStoreBase.getState().editorActions.updateModelVariablesForName('ReloadOpen', {
      display: 'code',
      code: 'VAR\n  a : INT;\nEND_VAR',
    })
    const onDisk = 'PROGRAM ReloadOpen\nVAR\n  (* from disk *)\n  a : DINT;\nEND_VAR\n\na := 1;\n\nEND_PROGRAM'

    await reloadPouFromDisk('ReloadOpen', portReturning(onDisk))

    const model = openPLCStoreBase.getState().editorActions.getEditorFromEditors('ReloadOpen')
    const variable = model && 'variable' in model ? model.variable : undefined
    expect(variable && 'code' in variable ? variable.code : undefined).toBe(
      'VAR\n  (* from disk *)\n  a : DINT;\nEND_VAR',
    )
    expect(textOf('ReloadOpen')).toBe('VAR\n  (* from disk *)\n  a : DINT;\nEND_VAR')
  })

  it('leaves a table-view model alone', async () => {
    seedTextualPou('ReloadTable', 'VAR\n  a : INT;\nEND_VAR')
    openEditor('ReloadTable')
    const onDisk = 'PROGRAM ReloadTable\nVAR\n  a : DINT;\nEND_VAR\n\na := 1;\n\nEND_PROGRAM'

    await reloadPouFromDisk('ReloadTable', portReturning(onDisk))

    const model = openPLCStoreBase.getState().editorActions.getEditorFromEditors('ReloadTable')
    const variable = model && 'variable' in model ? model.variable : undefined
    expect(variable?.display).toBe('table')
    expect(textOf('ReloadTable')).toBe('VAR\n  a : DINT;\nEND_VAR')
  })

  it('keeps an invalid set from disk as text and marks it for the code view', async () => {
    seedTextualPou('ReloadInvalid', 'VAR\n  a : INT;\nEND_VAR')
    const onDisk = 'PROGRAM ReloadInvalid\nVAR\n  a : INT;\n  a : DINT;\nEND_VAR\n\na := 1;\n\nEND_PROGRAM'

    await reloadPouFromDisk('ReloadInvalid', portReturning(onDisk))

    const pou = openPLCStoreBase.getState().project.data.pous.find((candidate) => candidate.name === 'ReloadInvalid')
    expect(pou?.variablesTextUnparsed).toBe(true)
    expect(pou?.variablesText).toBe('VAR\n  a : INT;\n  a : DINT;\nEND_VAR')
  })
})
