import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const FIXTURE_PACKAGE_ID = 'com.e2e.module-slots'
export const FIXTURE_BOARD = 'E2E-SLOTS'
export const BACKPLANE_SCREEN = 'Backplane Configuration'

/** Tall module artwork (120x480), the shape that pushed the I/O Mapping table out of the slot pane. */
const MODULE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAHgAAAHgCAIAAADhRD4fAAACcUlEQVR42u3QMQ0AAAgDsMlBBErwLwQPHFxNqqCpHh5EgWjRiBYt2oJo0YgWLdqCaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aJFKxAtGtGiRVsQLRrRokVbEC0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYvmbgEUzgfKGfbm9AAAAABJRU5ErkJggg==',
  'base64',
)

const channel = (name: string, input: boolean, bit: number) => ({
  name,
  type: input ? 'digitalInput' : 'digitalOutput',
  dataType: 'BOOL',
  addressPrefix: input ? '%IX' : '%QX',
  wire: { byte: 0, bit },
})

const fixtureModule = (id: string, name: string, inputs: number, outputs: number) => ({
  id,
  name,
  image: `assets/${id}.png`,
  description: `${inputs} discrete inputs and ${outputs} discrete outputs.`,
  specs: { Inputs: String(inputs), Outputs: String(outputs) },
  io: { digitalInputs: inputs, digitalOutputs: outputs, analogInputs: 0, analogOutputs: 0 },
  parameters: [],
  addressMapping: {
    baseAddressType: 'auto',
    channels: [
      ...Array.from({ length: inputs }, (_, index) => channel(`DI${index + 1}`, true, index)),
      ...Array.from({ length: outputs }, (_, index) => channel(`DO${index + 1}`, false, index)),
    ],
  },
})

const MODULES = [fixtureModule('e2e-16di', 'E2E-16DI', 16, 0), fixtureModule('e2e-8di-8do', 'E2E-8DI-8DO', 8, 8)]

const BACKPLANE_SCREEN_DEFINITION = {
  sections: [
    {
      id: 'backplane',
      title: BACKPLANE_SCREEN,
      layout: 'module-slots',
      maxSlots: 4,
      stackable: true,
      moduleSource: 'manifest',
      actions: [],
      persistence: 'module-configuration',
    },
  ],
}

/** Writes an unsigned package whose only board carries a module-slots backplane screen, plus the registry listing it. */
export function installModuleSlotsPackage(packagesDir: string): string {
  const root = join(packagesDir, FIXTURE_PACKAGE_ID)
  mkdirSync(join(root, 'screens'), { recursive: true })
  mkdirSync(join(root, 'assets'), { recursive: true })

  for (const module of MODULES) writeFileSync(join(root, 'assets', `${module.id}.png`), MODULE_PNG)
  writeFileSync(join(root, 'preview.png'), MODULE_PNG)
  writeFileSync(join(root, 'screens', 'backplane.json'), JSON.stringify(BACKPLANE_SCREEN_DEFINITION))
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({
      formatVersion: '1.0',
      package: { id: FIXTURE_PACKAGE_ID, name: 'E2E Module Slots', version: '1.0.0', vendor: { name: 'E2E' } },
      devices: [
        {
          id: 'e2e-slots',
          name: FIXTURE_BOARD,
          preview: 'preview.png',
          target: { type: 'runtime-v4' },
          hal: { type: 'plugin', pluginConfigFormat: 'io-ranges' },
          moduleSystem: { enabled: true, maxSlots: 4, modules: MODULES },
          screens: { [BACKPLANE_SCREEN]: 'screens/backplane.json' },
        },
      ],
    }),
  )
  writeFileSync(
    join(packagesDir, 'registry.json'),
    JSON.stringify({
      formatVersion: '1.0',
      packages: {
        [FIXTURE_PACKAGE_ID]: {
          version: '1.0.0',
          installedAt: new Date().toISOString(),
          path: root,
          devices: ['e2e-slots'],
        },
      },
    }),
  )
  return root
}
