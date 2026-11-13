import { defaultHmiSettings } from '../../../middleware/shared/utils/hmi/settings'
import type { OpenPLCStore } from '..'
import { HMI_SETTINGS_TAB_NAME } from '../slices/tabs/utils'
import { createTestStore } from '../testing'

let store: OpenPLCStore

beforeEach(() => {
  store = createTestStore()
})

const hmi = () => store.getState().project.data.hmi
const source = (kind: 'screen' | 'widget', name: string) =>
  (kind === 'screen' ? hmi()?.screens : hmi()?.widgets)?.find((f) => f.name === name)?.source

/** Resolves once the pending rename's modal is up, then answers it. */
async function answerRename(rename: Promise<unknown>, answer: boolean | null) {
  await Promise.resolve()
  expect(store.getState().pendingHmiRename).not.toBeNull()
  store.getState().hmiActions.respondToPendingRename(answer)
  return rename
}

describe('HMI actions', () => {
  it('creates a screen from its template, opens its tab and creates HMI Settings with the first element', () => {
    expect(store.getState().hmiActions.create('screen', 'Overview')).toEqual({ ok: true })
    const state = store.getState()
    expect(source('screen', 'Overview')).toMatch(/^FUNCTION_BLOCK Overview EXTENDS HmiScreen/)
    expect(hmi()?.settings).toEqual(defaultHmiSettings())
    expect(state.files['Overview']).toMatchObject({ type: 'hmi-screen', saved: false, isNew: true })
    expect(state.files[HMI_SETTINGS_TAB_NAME]).toMatchObject({ type: 'hmi-settings', saved: false })
    expect(state.selectedTab).toBe('Overview')
    expect(state.editor).toEqual({ type: 'plc-hmi', meta: { name: 'Overview', kind: 'screen' } })

    expect(store.getState().hmiActions.create('widget', 'Badge')).toEqual({ ok: true })
    expect(source('widget', 'Badge')).toMatch(/^FUNCTION_BLOCK Badge EXTENDS HmiElement/)
  })

  it('refuses names that are not identifiers or are taken by a POU, another HMI element or the HMI library', () => {
    const { hmiActions, pouActions } = store.getState()
    pouActions.create({ type: 'program', name: 'Main', language: 'st' })
    hmiActions.create('screen', 'Overview')
    expect(hmiActions.create('screen', 'main').ok).toBe(false)
    expect(hmiActions.create('widget', 'OVERVIEW')).toEqual({
      ok: false,
      message: '"OVERVIEW" is already the name of an HMI screen',
    })
    expect(hmiActions.create('screen', 'Overview')).toEqual({ ok: false, message: 'Screen name already exists' })
    expect(hmiActions.create('widget', 'HmiButton')).toEqual({
      ok: false,
      message: '"HmiButton" is taken by the HMI library',
    })
    expect(hmiActions.create('screen', 'HMI__X')).toEqual({
      ok: false,
      message: '"HMI__X" is taken by the HMI library',
    })
    expect(hmiActions.create('screen', '2nd').ok).toBe(false)
    expect(pouActions.create({ type: 'program', name: 'Overview', language: 'st' }).ok).toBe(false)
  })

  it('renames an unreferenced element, its header and file, without asking', async () => {
    store.getState().hmiActions.create('screen', 'Overview')
    await expect(store.getState().hmiActions.rename('screen', 'Overview', 'Home')).resolves.toEqual({ ok: true })
    expect(source('screen', 'Home')).toMatch(/^FUNCTION_BLOCK Home EXTENDS HmiScreen/)
    expect(store.getState().pendingDeletions).toContain('hmi/Overview.st')
    expect(store.getState().files['Home']).toMatchObject({ type: 'hmi-screen' })
    expect(store.getState().files['Overview']).toBeUndefined()
  })

  it('asks before renaming a referenced screen, and renames the references only when told to', async () => {
    const { hmiActions, projectActions } = store.getState()
    hmiActions.create('screen', 'Overview')
    hmiActions.create('screen', 'Details')
    projectActions.updateHmiSource(
      'screen',
      'Details',
      'FUNCTION_BLOCK Details EXTENDS HmiScreen\n  (* HMI_SCREEN#Overview *)\n  HMI_Show(HMI_SCREEN#Overview);\nEND_FUNCTION_BLOCK\n',
    )
    projectActions.updateHmiSettings({
      ...defaultHmiSettings(),
      startScreen: 'Overview',
      roles: { Overview: { engineer: true, operator: true, viewer: false } },
    })

    const renamed = await answerRename(store.getState().hmiActions.rename('screen', 'Overview', 'Home'), true)
    expect(renamed).toEqual({ ok: true })
    expect(source('screen', 'Details')).toContain('HMI_Show(HMI_SCREEN#Home);')
    expect(source('screen', 'Details')).toContain('(* HMI_SCREEN#Overview *)')
    expect(hmi()?.settings.startScreen).toBe('Home')
    expect(Object.keys(hmi()?.settings.roles ?? {})).toEqual(['Home'])
    expect(store.getState().files['Details'].saved).toBe(false)

    const kept = await answerRename(store.getState().hmiActions.rename('screen', 'Home', 'Start'), false)
    expect(kept).toEqual({ ok: true })
    expect(source('screen', 'Start')).toMatch(/^FUNCTION_BLOCK Start /)
    expect(source('screen', 'Details')).toContain('HMI_SCREEN#Home')
    expect(hmi()?.settings.startScreen).toBe('Home')
  })

  it('abandons a pending rename when the project closes', async () => {
    const { hmiActions } = store.getState()
    hmiActions.create('widget', 'Badge')
    hmiActions.create('screen', 'Overview')
    store.getState().projectActions.updateHmiSource('screen', 'Overview', 'VAR b : Badge; END_VAR')
    const rename = store.getState().hmiActions.rename('widget', 'Badge', 'Lamp2')
    await Promise.resolve()
    store.getState().sharedWorkspaceActions.clearStatesOnCloseProject()
    await expect(rename).resolves.toEqual({ ok: false, cancelled: true, message: 'Rename cancelled' })
  })

  it('renames nothing when the rename is cancelled from the impact modal', async () => {
    const { hmiActions } = store.getState()
    hmiActions.create('widget', 'Badge')
    hmiActions.create('screen', 'Overview')
    store.getState().projectActions.updateHmiSource('screen', 'Overview', 'VAR b : Badge; END_VAR')
    const cancelled = await answerRename(store.getState().hmiActions.rename('widget', 'Badge', 'Lamp2'), null)
    expect(cancelled).toEqual({ ok: false, cancelled: true, message: 'Rename cancelled' })
    expect(source('widget', 'Badge')).toMatch(/^FUNCTION_BLOCK Badge /)
    expect(source('widget', 'Lamp2')).toBeUndefined()
    expect(source('screen', 'Overview')).toBe('VAR b : Badge; END_VAR')
    expect(store.getState().pendingHmiRename).toBeNull()
  })

  it('asks before renaming a screen that navigates to itself, and renames its header and navigation', async () => {
    const { hmiActions, projectActions } = store.getState()
    hmiActions.create('screen', 'Nav')
    projectActions.updateHmiSource(
      'screen',
      'Nav',
      'FUNCTION_BLOCK Nav EXTENDS HmiScreen\n  HMI_Show(HMI_SCREEN#Nav);\nEND_FUNCTION_BLOCK\n',
    )
    const renamed = await answerRename(store.getState().hmiActions.rename('screen', 'Nav', 'Home'), true)
    expect(renamed).toEqual({ ok: true })
    expect(source('screen', 'Home')).toBe(
      'FUNCTION_BLOCK Home EXTENDS HmiScreen\n  HMI_Show(HMI_SCREEN#Home);\nEND_FUNCTION_BLOCK\n',
    )
  })

  it('deletes an element and queues its file, and duplicates one under a new header', () => {
    const { hmiActions } = store.getState()
    hmiActions.create('widget', 'Badge')
    expect(hmiActions.duplicate('widget', 'Badge', 'Badge2')).toEqual({ ok: true })
    expect(source('widget', 'Badge2')).toMatch(/^FUNCTION_BLOCK Badge2 EXTENDS HmiElement/)
    expect(hmiActions.duplicate('widget', 'Nope', 'X')).toEqual({ ok: false, message: 'Widget block not found' })
    store.getState().hmiActions.delete('widget', 'Badge')
    expect(hmi()?.widgets.map((w) => w.name)).toEqual(['Badge2'])
    expect(store.getState().pendingDeletions).toContain('hmi/widgets/Badge.st')
    expect(store.getState().files['Badge']).toBeUndefined()
  })

  it('opens the HMI Settings tab only when the project has an HMI', () => {
    store.getState().hmiActions.openSettings()
    expect(store.getState().tabs).toEqual([])
    store.getState().hmiActions.create('screen', 'Overview')
    store.getState().hmiActions.openSettings()
    expect(store.getState().selectedTab).toBe(HMI_SETTINGS_TAB_NAME)
    expect(store.getState().editor).toEqual({ type: 'plc-hmi-settings', meta: { name: HMI_SETTINGS_TAB_NAME } })
  })

  it('registers HMI files when a project opens', () => {
    store.getState().sharedWorkspaceActions.handleOpenProjectResponse({
      meta: { name: 'P', type: 'plc-project', path: '/p' },
      projectData: {
        dataTypes: [],
        pous: [],
        configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
        hmi: {
          screens: [{ name: 'Main', source: 'S' }],
          widgets: [{ name: 'W', source: 'X' }],
          settings: defaultHmiSettings(),
        },
      },
    })
    const { files } = store.getState()
    expect(files['Main']).toMatchObject({ type: 'hmi-screen', saved: true })
    expect(files['W']).toMatchObject({ type: 'hmi-widget', saved: true })
    expect(files[HMI_SETTINGS_TAB_NAME]).toMatchObject({ type: 'hmi-settings', saved: true })
  })
})
