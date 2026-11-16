import { computeIoImage, IMAGE_AREAS_RUNTIME_V4 } from '../steps/compute-io-image'

const ALL = { pinMapping: true, vppIo: true, modbusTcpMaster: true, modbusRtuMaster: true, ethercat: true }
const SERVERS = { modbusTcpServer: true, opcuaServer: true, s7Server: true }

const withChannels = (locs: string[]) =>
  computeIoImage({
    projectData: {
      pous: [],
      globalVariableLists: [],
      dataTypes: [],
      configuration: { resource: { globalVariables: [], tasks: [], instances: [] } },
      remoteDevices: [
        {
          name: 'ecat',
          ethercatConfig: {
            devices: [
              { name: 'slave1', channelMappings: locs.map((l, i) => ({ channelId: `c${i}`, iecLocation: l })) },
            ],
          },
        },
      ],
    } as never,
    capabilities: ALL as never,
    serverCapabilities: SERVERS,
    areas: IMAGE_AREAS_RUNTIME_V4,
  })

describe('E25 — sparse at the source', () => {
  it('reproduces the disk: 3 channels at byte offsets ask for 17 lwords', () => {
    const img = withChannels(['%IL0', '%IL8', '%IL16'])
    // eslint-disable-next-line no-console
    console.log(`[E25] sparse   -> ${JSON.stringify(img.sizes)}`)
    expect(img.sizes['%IL']).toBe(17)
  })

  it('control: compacted by the recalculation, the same 3 ask for 4', () => {
    const img = withChannels(['%IL1', '%IL2', '%IL3'])
    // eslint-disable-next-line no-console
    console.log(`[E25] compact  -> ${JSON.stringify(img.sizes)}`)
    expect(img.sizes['%IL']).toBe(4)
  })
})
