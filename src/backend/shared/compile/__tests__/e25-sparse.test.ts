/**
 * E25 da bancada — projeto que chega esparso e nunca foi recalculado.
 *
 * O esi-parser propoe offsets de BYTE para os canais; enquanto nenhuma tela de
 * produtor for aberta, o disco guarda %IL0/%IL8/%IL16 para tres canais LWORD.
 * O compilador reproduz o que esta em disco -- ele nao compacta.
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

describe('E25 — esparso na origem', () => {
  it('reproduz o disco: 3 canais em offsets de byte pedem 17 lwords', () => {
    const img = withChannels(['%IL0', '%IL8', '%IL16'])
    // eslint-disable-next-line no-console
    console.log(`[E25] esparso  -> ${JSON.stringify(img.sizes)}`)
    expect(img.sizes['%IL']).toBe(17)
  })

  it('controle: compactado pelo recalculo, os mesmos 3 canais pedem 4', () => {
    // O que updateEthercatConfig produz ao abrir e salvar a tela.
    const img = withChannels(['%IL1', '%IL2', '%IL3'])
    // eslint-disable-next-line no-console
    console.log(`[E25] compacto -> ${JSON.stringify(img.sizes)}`)
    expect(img.sizes['%IL']).toBe(4)
  })
})
