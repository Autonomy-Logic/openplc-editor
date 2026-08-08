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
import { executeSaveFile, executeSaveProject } from '../save-actions'

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
      const savedFiles = (port: ProjectPort) => (port.saveProject as ReturnType<typeof vi.fn>).mock.calls[0][0]

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
