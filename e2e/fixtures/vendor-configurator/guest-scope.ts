import type {
  DeviceEditorConsumerLike,
  DeviceEditorProviderLike,
} from '../../../src/middleware/shared/vendor-document/relay'

declare global {
  interface Window {
    DeviceEditorProvider?: DeviceEditorProviderLike
    DeviceEditorConsumer?: DeviceEditorConsumerLike
  }
}

export {}
