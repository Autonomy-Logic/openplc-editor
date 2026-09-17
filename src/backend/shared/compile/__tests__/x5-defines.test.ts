/** X5 (metade da medicao): o bloco de process image que o F1 emite. */
import { computeIoImage, IMAGE_AREAS_BAREMETAL } from '../steps/compute-io-image'

const ALL = { pinMapping: true, vppIo: true, modbusTcpRemote: true, ethercat: true }
const SERVERS = { modbusTcpServer: false, opcuaServer: false, s7Server: false }

it('X5 — projeto minimo (8 DI, 8 DO, 4 %MW)', () => {
  const pins = [
    ...Array.from({ length: 8 }, (_, i) => ({
      pin: `d${i}`,
      pinType: 'digitalInput' as const,
      address: `%IX${Math.floor(i / 8)}.${i % 8}`,
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      pin: `o${i}`,
      pinType: 'digitalOutput' as const,
      address: `%QX${Math.floor(i / 8)}.${i % 8}`,
    })),
  ]
  const img = computeIoImage({
    projectData: {
      pous: [
        {
          type: 'program',
          data: {
            name: 'main',
            variables: Array.from({ length: 4 }, (_, i) => ({
              name: `m${i}`,
              location: `%MW${i}`,
              documentation: '',
              type: { definition: 'base-type', value: 'INT' },
            })),
          },
        },
      ],
      globalVariableLists: [],
      dataTypes: [],
      configuration: { resource: { globalVariables: [], tasks: [], instances: [] } },
    } as never,
    devicePinMapping: pins as never,
    capabilities: ALL as never,
    serverCapabilities: SERVERS,
    areas: IMAGE_AREAS_BAREMETAL,
  })
  // eslint-disable-next-line no-console
  console.log(`[X5] imagem do projeto minimo: ${JSON.stringify(img.sizes)}`)
  expect(img.sizes['%IX']).toBe(8)
  expect(img.sizes['%QX']).toBe(8)
  expect(img.sizes['%MW']).toBe(4)
})
