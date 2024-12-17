import { join } from 'node:path'

import { access, constants } from 'fs/promises'

import webpackPaths from '../configs/webpack/webpack.paths'

// Verify if the compiler is already built
access(join(webpackPaths.rootPath, 'assets', 'st-compiler'), constants.R_OK)
  .then(() => console.log('st-compiler exists'))
  .catch(() => console.log('st-compiler does not exist'))

