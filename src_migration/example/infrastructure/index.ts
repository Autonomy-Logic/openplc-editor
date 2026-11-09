// Public entry of the infrastructure layer: adapters that implement the application's output ports.
export { createInMemoryPersistence, type InMemoryPersistence } from './in-memory-persistence'
export { createLocalStoragePersistence, type KeyValueStorage } from './local-storage-persistence'
