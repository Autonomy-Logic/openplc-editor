import { app } from 'electron'
import { join } from 'path'

import { logger } from '../services'
import { createOwnerOnlyTextFile } from '../utils/owner-only-file'
import {
  createRuntimeIdentityStore,
  RUNTIME_IDENTITY_DIR,
  RUNTIME_IDENTITY_FILE,
  RUNTIME_IDENTITY_MAX_BYTES,
  type RuntimeIdentityStore,
} from './runtime-identity-store'

export const createElectronRuntimeIdentityStore = (
  userDataDir: string = app.getPath('userData'),
): RuntimeIdentityStore =>
  createRuntimeIdentityStore({
    storage: createOwnerOnlyTextFile(
      join(userDataDir, RUNTIME_IDENTITY_DIR),
      RUNTIME_IDENTITY_FILE,
      RUNTIME_IDENTITY_MAX_BYTES,
      'runtime identity',
    ),
    log: (level, line) => {
      if (level === 'info') logger.info(line)
      else logger.warn(line)
    },
  })
