import type {
  DeviceEditorConsumerLike,
  DeviceEditorProviderLike,
} from '../../../src/__fixtures__/fake-device-editor/relay'

declare global {
  interface Window {
    DeviceEditorProvider?: DeviceEditorProviderLike
    DeviceEditorConsumer?: DeviceEditorConsumerLike
  }
}

export {}
