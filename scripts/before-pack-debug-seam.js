const { execFileSync } = require('child_process')
const { existsSync } = require('fs')
const path = require('path')

exports.default = function beforePack() {
  const objects = path.join(__dirname, '..', 'release', 'hmi-objects', 'index.json')
  if (!existsSync(objects)) throw new Error(`No compiled HMI objects to ship (${objects}): run npm run build:hmi-objects`)
  const renderer = path.join(__dirname, '..', 'release', 'app', 'dist', 'renderer')
  execFileSync(process.execPath, [path.join(__dirname, 'check-debug-seam-leak.mjs'), renderer], { stdio: 'inherit' })
}
