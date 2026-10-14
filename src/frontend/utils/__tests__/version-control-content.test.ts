import { pickContentForSave } from '../version-control-content'

/**
 * The save derives a project's libraries from the blocks it uses. On open, the
 * snapshot it compares against already includes them, so a project saved
 * before that rule existed looked "unchanged" and its raw project.json — with
 * no libraries at all — was echoed back, and the other editor never got
 * anything to warn about.
 */
describe('pickContentForSave and project.json libraries', () => {
  const raw = JSON.stringify({ meta: { name: 'P' }, data: { libraries: [] } })
  const fresh = JSON.stringify({ meta: { name: 'P' }, data: { libraries: [{ name: 'demo-utils', version: '1.0.0' }] } })

  it('uploads the fresh project.json when it declares a library the raw one lacks', () => {
    const picked = pickContentForSave('project.json', fresh, {
      loadedSerialized: { 'project.json': fresh },
      rawLoadedContent: { 'project.json': raw },
    })

    expect(picked).toBe(fresh)
  })

  it('still echoes the raw bytes when the libraries agree', () => {
    const rawSame = JSON.stringify({
      meta: { name: 'P' },
      data: { libraries: [{ name: 'demo-utils', version: '1.0.0' }] },
    })
    const picked = pickContentForSave('project.json', fresh, {
      loadedSerialized: { 'project.json': fresh },
      rawLoadedContent: { 'project.json': rawSame },
    })

    expect(picked).toBe(rawSame)
  })

  it('leaves every other path on the plain unchanged-means-raw rule', () => {
    const picked = pickContentForSave('pous/programs/main.st', 'fresh', {
      loadedSerialized: { 'pous/programs/main.st': 'fresh' },
      rawLoadedContent: { 'pous/programs/main.st': 'raw bytes' },
    })

    expect(picked).toBe('raw bytes')
  })
})

describe('pickContentForSave and MQTT server files', () => {
  const path = 'devices/servers/Broker.json'
  const fresh = JSON.stringify({ name: 'Broker', protocol: 'mqtt', mqttConfig: { formatVersion: 1 } })
  const raw = JSON.stringify({
    name: 'Broker',
    protocol: 'mqtt',
    mqttConfig: { formatVersion: 1, password: 'MARKER-SECRET-vc' },
  })

  it('writes the fresh serialization even when the server looks unchanged since open', () => {
    const picked = pickContentForSave(path, fresh, {
      loadedSerialized: { [path]: fresh },
      rawLoadedContent: { [path]: raw },
    })

    expect(picked).toBe(fresh)
    expect(picked).not.toContain('MARKER-SECRET-vc')
  })

  it('keeps echoing the raw bytes of other server files and of unparseable text', () => {
    const modbus = JSON.stringify({ name: 'S', protocol: 'modbus-tcp' })
    const modbusRaw = `${modbus}\n`
    const otherPath = 'devices/servers/S.json'
    expect(
      pickContentForSave(otherPath, modbus, {
        loadedSerialized: { [otherPath]: modbus },
        rawLoadedContent: { [otherPath]: modbusRaw },
      }),
    ).toBe(modbusRaw)
    expect(
      pickContentForSave(otherPath, modbus, {
        loadedSerialized: { [otherPath]: modbus },
        rawLoadedContent: { [otherPath]: '{not json' },
      }),
    ).toBe('{not json')
  })

  it('only applies to server files', () => {
    const picked = pickContentForSave('devices/remote/Broker.json', fresh, {
      loadedSerialized: { 'devices/remote/Broker.json': fresh },
      rawLoadedContent: { 'devices/remote/Broker.json': raw },
    })

    expect(picked).toBe(raw)
  })
})
