import { createEditorOrchestratorAdapter } from '../orchestrator-adapter'

describe('createEditorOrchestratorAdapter', () => {
  it('returns an empty array from listOrchestrators', async () => {
    const adapter = createEditorOrchestratorAdapter()
    const result = await adapter.listOrchestrators()

    expect(result).toEqual([])
  })
})
