const { execFileSync } = require('child_process')
const path = require('path')

exports.default = function beforePack() {
  const renderer = path.join(__dirname, '..', 'release', 'app', 'dist', 'renderer')
  execFileSync(process.execPath, [path.join(__dirname, 'check-debug-seam-leak.mjs'), renderer], { stdio: 'inherit' })
}
