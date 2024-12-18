import { join } from 'path'

const rootPath = join(__dirname, '../..')

const dllPath = join(__dirname, '../dll')

const srcPath = join(rootPath, 'src')
const srcMainPath = join(srcPath, 'main')
const srcRendererPath = join(srcPath, 'renderer')

const releasePath = join(rootPath, 'release')
const appPath = join(releasePath, 'app')
const appPackagePath = join(appPath, 'package.json')
const appNodeModulesPath = join(appPath, 'node_modules')
const srcNodeModulesPath = join(srcPath, 'node_modules')

const distPath = join(appPath, 'dist')
const distMainPath = join(distPath, 'main')
const distRendererPath = join(distPath, 'renderer')

const buildPath = join(releasePath, 'build')

const typesPath = join(srcPath, 'types')

export default {
  rootPath,
  dllPath,
  srcPath,
  srcMainPath,
  srcRendererPath,
  releasePath,
  appPath,
  appPackagePath,
  appNodeModulesPath,
  srcNodeModulesPath,
  distPath,
  distMainPath,
  distRendererPath,
  buildPath,
  typesPath,
}
