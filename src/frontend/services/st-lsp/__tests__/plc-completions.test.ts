import { hmiFileUri } from '../../hmi-code/uris'
import { HMI_GLUE_URI } from '../hmi-sync'
import { plcCompletionItems } from '../plc-completions'

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
