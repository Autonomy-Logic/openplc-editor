import { collectAllSlaveNames, generateUniqueSlaveName } from '../unique-slave-name'

describe('collectAllSlaveNames', () => {
  it('returns empty set when remoteDevices is undefined', () => {
    expect(collectAllSlaveNames(undefined)).toEqual(new Set())
  })

  it('returns empty set when there are no remote devices', () => {
    expect(collectAllSlaveNames([])).toEqual(new Set())
  })

  it('returns empty set when remote devices have no ethercat config', () => {
    expect(collectAllSlaveNames([{}, { ethercatConfig: undefined }])).toEqual(new Set())
  })

  it('returns empty set when ethercat config has no devices array', () => {
    expect(collectAllSlaveNames([{ ethercatConfig: {} }])).toEqual(new Set())
  })

  it('collects names from a single master', () => {
    const result = collectAllSlaveNames([{ ethercatConfig: { devices: [{ name: 'EL1809' }, { name: 'EL2008' }] } }])
    expect(result).toEqual(new Set(['EL1809', 'EL2008']))
  })

  it('collects names across multiple masters and deduplicates', () => {
    const result = collectAllSlaveNames([
      { ethercatConfig: { devices: [{ name: 'EL1809' }, { name: 'EL2008' }] } },
      { ethercatConfig: { devices: [{ name: 'EL1809' }, { name: 'EL3104' }] } },
    ])
    expect(result).toEqual(new Set(['EL1809', 'EL2008', 'EL3104']))
  })
})

describe('generateUniqueSlaveName', () => {
  it('returns base when not taken', () => {
    expect(generateUniqueSlaveName('EL1809', [])).toBe('EL1809')
    expect(generateUniqueSlaveName('EL1809', ['EL2008'])).toBe('EL1809')
  })

  it('returns _01 suffix on first collision', () => {
    expect(generateUniqueSlaveName('EL1809', ['EL1809'])).toBe('EL1809_01')
  })

  it('skips taken suffixes and picks the next free one', () => {
    expect(generateUniqueSlaveName('EL1809', ['EL1809', 'EL1809_01', 'EL1809_02'])).toBe('EL1809_03')
  })

  it('pads single digits to two digits and widens past 99', () => {
    const taken = new Set<string>(['EL1809'])
    for (let i = 1; i <= 99; i++) taken.add(`EL1809_${String(i).padStart(2, '0')}`)
    expect(generateUniqueSlaveName('EL1809', taken)).toBe('EL1809_100')
  })

  it('accepts a Set directly as the existing argument', () => {
    expect(generateUniqueSlaveName('EL1809', new Set(['EL1809']))).toBe('EL1809_01')
  })
})
