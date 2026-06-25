import { orderBoardsByVppGroup } from '../order-boards-by-vpp-group'
import type { AvailableBoards } from '../types'

// The Map's value type is declared inline in `types.ts`; derive it the
// same way the helper does. Tests only care about the `vpp.packageId`
// field, so we cast minimal objects through `unknown`.
type AvailableBoardInfo = AvailableBoards extends Map<string, infer V> ? V : never
const builtIn = (): AvailableBoardInfo => ({}) as unknown as AvailableBoardInfo
const vppBoard = (packageId: string): AvailableBoardInfo => ({ vpp: { packageId } }) as unknown as AvailableBoardInfo

describe('orderBoardsByVppGroup', () => {
  it('returns an empty Map untouched', () => {
    const result = orderBoardsByVppGroup(new Map())
    expect(result.size).toBe(0)
  })

  it('keeps the three built-in targets at the top, sorted by name', () => {
    // Insertion order intentionally non-alphabetical so we can prove the
    // function sorts rather than passing through whatever the caller built.
    const input: AvailableBoards = new Map([
      ['OpenPLC Simulator', builtIn()],
      ['OpenPLC Runtime v4', builtIn()],
      ['OpenPLC Runtime v3', builtIn()],
    ])
    expect([...orderBoardsByVppGroup(input).keys()]).toEqual([
      'OpenPLC Runtime v3',
      'OpenPLC Runtime v4',
      'OpenPLC Simulator',
    ])
  })

  it('groups VPP devices contiguously by package id, never interleaving across packages', () => {
    // Mixed input: a board from `arduino`, one from `espressif`, another
    // from `arduino` — naive alphabetical sort would scatter them. The
    // function must keep `com.openplc.arduino` together before
    // `com.openplc.espressif`.
    const input: AvailableBoards = new Map([
      ['ESP32 Generic', vppBoard('com.openplc.espressif')],
      ['Arduino Uno', vppBoard('com.openplc.arduino')],
      ['ESP8266 NodeMCU', vppBoard('com.openplc.espressif')],
      ['Arduino Mega', vppBoard('com.openplc.arduino')],
    ])
    expect([...orderBoardsByVppGroup(input).keys()]).toEqual([
      'Arduino Mega',
      'Arduino Uno',
      'ESP32 Generic',
      'ESP8266 NodeMCU',
    ])
  })

  it('sorts VPP groups alphabetically by package id, then devices alphabetically inside each group', () => {
    const input: AvailableBoards = new Map([
      ['Foo', vppBoard('com.vendor.b')],
      ['Bar', vppBoard('com.vendor.a')],
      ['Baz', vppBoard('com.vendor.b')],
      ['Qux', vppBoard('com.vendor.a')],
    ])
    expect([...orderBoardsByVppGroup(input).keys()]).toEqual(['Bar', 'Qux', 'Baz', 'Foo'])
  })

  it('places built-ins ahead of every VPP group regardless of name', () => {
    // A VPP board name that would sort before "OpenPLC Runtime v3" alphabetically
    // ("Arduino Uno" < "OpenPLC ...") must still appear AFTER built-ins.
    const input: AvailableBoards = new Map([
      ['Arduino Uno', vppBoard('com.openplc.arduino')],
      ['OpenPLC Runtime v3', builtIn()],
      ['OpenPLC Simulator', builtIn()],
    ])
    expect([...orderBoardsByVppGroup(input).keys()]).toEqual(['OpenPLC Runtime v3', 'OpenPLC Simulator', 'Arduino Uno'])
  })

  it('treats VPP entries with falsy packageId as built-ins (defensive against malformed manifests)', () => {
    const malformed = { vpp: { packageId: '' } } as unknown as AvailableBoardInfo
    const input: AvailableBoards = new Map([
      ['Broken Board', malformed],
      ['Real Board', vppBoard('com.openplc.arduino')],
    ])
    // "Broken Board" with empty packageId falls back into built-ins, sorts
    // alphabetically with them, lands ahead of the VPP group.
    expect([...orderBoardsByVppGroup(input).keys()]).toEqual(['Broken Board', 'Real Board'])
  })

  it('preserves the original BoardInfo references (no clone, no field rewrite)', () => {
    const built = builtIn()
    const vpp = vppBoard('com.openplc.arduino')
    const input: AvailableBoards = new Map([
      ['Arduino Uno', vpp],
      ['OpenPLC Simulator', built],
    ])
    const result = orderBoardsByVppGroup(input)
    expect(result.get('OpenPLC Simulator')).toBe(built)
    expect(result.get('Arduino Uno')).toBe(vpp)
  })

  it('produces a fresh Map (does not mutate the input)', () => {
    const input: AvailableBoards = new Map([
      ['B', vppBoard('com.openplc.a')],
      ['A', vppBoard('com.openplc.a')],
    ])
    const snapshot = [...input.keys()]
    orderBoardsByVppGroup(input)
    expect([...input.keys()]).toEqual(snapshot)
  })

  it('models the canonical openplc-arduino + openplc-espressif install scenario end-to-end', () => {
    // Reproduces the user-reported pain point: alphabetical sort interleaved
    // an Arduino board between two Espressif boards. The grouping fixes it
    // while keeping built-ins on top.
    const input: AvailableBoards = new Map([
      ['Arduino Uno R4 WiFi', vppBoard('com.openplc.arduino')],
      ['ESP32 Generic', vppBoard('com.openplc.espressif')],
      ['Arduino Mega', vppBoard('com.openplc.arduino')],
      ['ESP8266 D1-mini', vppBoard('com.openplc.espressif')],
      ['OpenPLC Runtime v4', builtIn()],
      ['Arduino Uno', vppBoard('com.openplc.arduino')],
      ['OpenPLC Simulator', builtIn()],
      ['OpenPLC Runtime v3', builtIn()],
      ['ESP32 WROOM', vppBoard('com.openplc.espressif')],
    ])
    expect([...orderBoardsByVppGroup(input).keys()]).toEqual([
      // Built-ins, alphabetical
      'OpenPLC Runtime v3',
      'OpenPLC Runtime v4',
      'OpenPLC Simulator',
      // com.openplc.arduino group, alphabetical
      'Arduino Mega',
      'Arduino Uno',
      'Arduino Uno R4 WiFi',
      // com.openplc.espressif group, alphabetical
      'ESP32 Generic',
      'ESP32 WROOM',
      'ESP8266 D1-mini',
    ])
  })
})
