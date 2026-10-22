/**
 * Test double of the vendor Device Editor bundle. Publishes `DeviceEditorProvider` at once
 * and its own `DeviceEditorConsumer` later, as the vendor does, and fires
 * `setProjectModified` as the vendor does: 2 on `setController`, 1 per `setProject`, 1 per edit.
 */

import type {
  DeviceEditorConsumerLike,
  DeviceEditorProviderLike,
  RelayGuestScope,
} from '../../middleware/shared/vendor-document/relay'

export interface FakeDataPoint {
  id: string
  name: string
  min: string
  max: string
  datatype: string
  byteoffset: number
  bitoffset: number
  bitlength: number
  access?: string
}

export interface FakeModule {
  guid: string
  name: string
  typeId: string
}

type ChannelTemplate = Omit<FakeDataPoint, 'id'>

const bitarea = (name: string, bitlength: number, access: string): ChannelTemplate => ({
  name,
  min: '0',
  max: '1',
  datatype: 'Bitarea',
  byteoffset: 0,
  bitoffset: 0,
  bitlength,
  access,
})

const scalar = (
  name: string,
  datatype: string,
  byteoffset: number,
  bitlength: number,
  access?: string,
  bitoffset = 0,
): ChannelTemplate => ({
  name,
  min: '0',
  max: '0',
  datatype,
  byteoffset,
  bitoffset,
  bitlength,
  access,
})

/**
 * Module catalog of the fake: covers BOOL, UInt8, INT, DINT, REAL, Bitarea and unusual `access` values.
 * Like the bundle, no datapoint carries `direction`.
 */
export const FAKE_MODULE_TYPES: Record<string, ChannelTemplate[]> = {
  'FAKE-4DI': [bitarea('DI', 4, 'ro'), scalar('status', 'UInt8', 1, 8, 'ro')],
  'FAKE-4DO': [bitarea('DO', 4, 'wo'), scalar('enable', 'BOOL', 1, 1, 'wo', 3)],
  'FAKE-2AI': [
    scalar('AI0', 'INT', 0, 16, 'ro'),
    scalar('AI1', 'INT', 2, 16, 'ro'),
    scalar('counter', 'DINT', 4, 32, 'ro'),
    scalar('temperature', 'REAL', 8, 32, 'ro'),
  ],
  'FAKE-MIX': [
    scalar('setpoint', 'UInt8', 0, 8, 'wo'),
    scalar('mode', 'INT', 1, 16, 'rw'),
    scalar('reserved', 'UInt8', 3, 8),
  ],
}

/** Bundle id format `<module guid>_<index>[_<bit>]`; the fake adds `_<bit>` to single-bit datapoints. */
function dataPointId(guid: string, index: number, template: ChannelTemplate): string {
  return template.bitlength === 1 ? `${guid}_${index}_${template.bitoffset}` : `${guid}_${index}`
}

export interface FakeDeviceEditorOptions {
  /** Delay before the bundle publishes its own consumer. */
  consumerDelayMs?: number
  /** `silent`: `setProject` resolves without applying. `reject`: it rejects as for a corrupt archive. */
  loadFailure?: 'silent' | 'reject'
  /** Renders a minimal UI with add/remove buttons into this document. */
  document?: Document
}

interface FakeState {
  controller: string
  nextGuid: number
  modules: FakeModule[]
}

const emptyState = (): FakeState => ({ controller: '', nextGuid: 1, modules: [] })

function encodeArchive(state: FakeState): string {
  return Array.from(new TextEncoder().encode(JSON.stringify(state)), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

function isFakeState(value: unknown): value is FakeState {
  if (typeof value !== 'object' || value === null) return false
  const record = Object.fromEntries(Object.entries(value))
  return (
    typeof record.controller === 'string' &&
    typeof record.nextGuid === 'number' &&
    Array.isArray(record.modules) &&
    record.modules.every(
      (module: unknown) =>
        typeof module === 'object' &&
        module !== null &&
        ['guid', 'name', 'typeId'].every((key) => typeof Object.fromEntries(Object.entries(module))[key] === 'string'),
    )
  )
}

function decodeArchive(archive: string): FakeState {
  if (!/^(?:[0-9a-f]{2})+$/.test(archive)) throw new Error('invalid archive')
  const bytes = new Uint8Array(archive.match(/../g)?.map((pair) => parseInt(pair, 16)) ?? [])
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!isFakeState(parsed)) throw new Error('invalid archive')
  return parsed
}

export interface FakeDeviceEditorHandle {
  addModule(typeId: string): FakeModule
  removeModule(guid: string): void
  readonly modules: readonly FakeModule[]
  readonly controller: string
}

export function installFakeDeviceEditor(
  scope: RelayGuestScope,
  options: FakeDeviceEditorOptions = {},
): FakeDeviceEditorHandle {
  let state = emptyState()
  const consumer: DeviceEditorConsumerLike = {
    setProjectModified: () => Promise.resolve(),
    setLiveDataArrived: () => Promise.resolve(),
  }
  let consumerPublished = false
  const modified = () => {
    if (consumerPublished) void consumer.setProjectModified()
  }

  const render = () => {
    const doc = options.document
    if (!doc?.body) return
    doc.body.replaceChildren()
    const list = doc.createElement('ul')
    list.setAttribute('data-testid', 'fake-modules')
    for (const module of state.modules) {
      const item = doc.createElement('li')
      item.textContent = `${module.name} (${module.typeId})`
      const remove = doc.createElement('button')
      remove.textContent = `Remove ${module.name}`
      remove.addEventListener('click', () => handle.removeModule(module.guid))
      item.append(remove)
      list.append(item)
    }
    doc.body.append(list)
    for (const typeId of Object.keys(FAKE_MODULE_TYPES)) {
      const add = doc.createElement('button')
      add.textContent = `Add ${typeId}`
      add.addEventListener('click', () => handle.addModule(typeId))
      doc.body.append(add)
    }
  }

  const provider: DeviceEditorProviderLike = {
    show: () => {
      render()
      return Promise.resolve()
    },
    setController: (deviceTypeId) => {
      state = { ...state, controller: deviceTypeId }
      modified()
      modified()
      return Promise.resolve()
    },
    setProject: (data) => {
      if (options.loadFailure === 'reject') return Promise.reject(new Error('invalid archive'))
      if (options.loadFailure === 'silent') return Promise.resolve()
      try {
        state = data ? decodeArchive(data) : emptyState()
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error('invalid archive'))
      }
      render()
      modified()
      return Promise.resolve()
    },
    getConfiguration: () => Promise.resolve(encodeArchive(state)),
    getDeviceSetup: () =>
      Promise.resolve({
        systembus: { guid: 'systembus', name: state.controller, typeId: state.controller },
        devices: state.modules.map((module) => ({ ...module })),
      }),
    getDataPoints: () =>
      Promise.resolve(
        state.modules.flatMap((module) =>
          (FAKE_MODULE_TYPES[module.typeId] ?? []).map((template, index) => ({
            ...template,
            id: dataPointId(module.guid, index, template),
          })),
        ),
      ),
  }

  const handle: FakeDeviceEditorHandle = {
    addModule: (typeId) => {
      if (!FAKE_MODULE_TYPES[typeId]) throw new Error(`unknown module type ${typeId}`)
      const guid = `fake-${String(state.nextGuid).padStart(4, '0')}`
      const module = { guid, name: `${typeId}_${state.nextGuid}`, typeId }
      state = { ...state, nextGuid: state.nextGuid + 1, modules: [...state.modules, module] }
      render()
      modified()
      return module
    },
    removeModule: (guid) => {
      state = { ...state, modules: state.modules.filter((module) => module.guid !== guid) }
      render()
      modified()
    },
    get modules() {
      return state.modules
    },
    get controller() {
      return state.controller
    },
  }

  scope.DeviceEditorProvider = provider
  setTimeout(() => {
    scope.DeviceEditorConsumer = consumer
    consumerPublished = true
  }, options.consumerDelayMs ?? 0)

  return handle
}
