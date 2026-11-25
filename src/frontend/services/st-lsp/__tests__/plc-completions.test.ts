import { libraryPouRequirements } from '../../../../middleware/shared/utils/library/pou-requirements'
import { hmiFileUri } from '../../hmi-code/uris'
import { HMI_GLUE_URI } from '../hmi-sync'
import { plcCompletionItems, projectPlcUnusablePous } from '../plc-completions'

describe('plcCompletionItems', () => {
  const items = [{ label: 'HmiButton' }, { label: { label: 'HmiGauge' } }, { label: 'TON' }, { label: 'counter' }]
  const unusable = ['HMIBUTTON', 'HMIGAUGE']

  it('hides the library POUs a PLC build cannot use from PLC documents', () => {
    expect(plcCompletionItems('inmemory://pou/main.st', items, unusable)).toEqual([
      { label: 'TON' },
      { label: 'counter' },
    ])
  })

  it('keeps them in HMI screens, widget blocks and the HMI glue, which HMI builds compile', () => {
    for (const uri of [hmiFileUri('screen', 'Main'), hmiFileUri('widget', 'Badge'), HMI_GLUE_URI])
      expect(plcCompletionItems(uri, items, unusable)).toBe(items)
  })

  it('keeps everything when no POU is unusable', () => {
    expect(plcCompletionItems('inmemory://pou/main.st', items, [])).toBe(items)
  })
})

describe('projectPlcUnusablePous', () => {
  const chunk = (name: string, extra: object = {}) => ({
    name,
    kind: 'functionBlock',
    header: '',
    cpp: '',
    deps: [],
    headers: [],
    ...extra,
  })
  const archive = (name: string, chunks: object[], dependencies: object[] = []) => ({
    formatVersion: 1,
    manifest: { name, version: '1.0.0', namespace: name, functions: [], functionBlocks: [], types: [], headers: [] },
    chunks,
    dependencies,
    sources: [],
    globalConstants: {},
  })
  const widgets = archive('widgets', [
    chunk('HMIELEMENT', { headers: [{ name: 'hmi_core.h', version: '1' }] }),
    chunk('FMT'),
  ])
  const extra = archive(
    'extra',
    [chunk('USESFMT', { deps: [{ library: 'widgets', name: 'FMT' }] }), chunk('LONE')],
    [{ name: 'widgets', version: '1.0.0' }],
  )
  const pouRequirements = libraryPouRequirements([widgets, extra])

  it('hides widgets of the bundled libraries from PLC completions', () => {
    const state = { pouRequirements, bundledLibraryNames: ['widgets'], enabledLibraries: [] }
    expect(projectPlcUnusablePous(state)).toEqual(['HMIELEMENT'])
  })

  it('works over the libraries the project uses, so a listed library reaching an unused one loses those POUs', () => {
    const state = { pouRequirements, bundledLibraryNames: [], enabledLibraries: ['extra'] }
    expect(projectPlcUnusablePous(state)).toEqual(['USESFMT'])
  })
})
