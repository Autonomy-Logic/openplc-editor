/**
 * Bench case E25 — a project that arrives sparse and was never recalculated.
 *
 * The ESI parser proposes BYTE offsets for the channels, so until a producer
 * screen is opened the disk holds %IL0/%IL8/%IL16 for three LWORD channels.
 * The compiler reproduces what is on disk -- it does not compact it.
 */
import { computeIoImage, IMAGE_AREAS_RUNTIME_V4 } from '../steps/compute-io-image'

const ALL = { pinMapping: true, vppIo: true, modbusTcpRemote: true, ethercat: true }
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
    // What updateEthercatConfig produces when the screen is opened and saved.
    const img = withChannels(['%IL1', '%IL2', '%IL3'])
    // eslint-disable-next-line no-console
    console.log(`[E25] compact  -> ${JSON.stringify(img.sizes)}`)
    expect(img.sizes['%IL']).toBe(4)
  })
})
