import fs from 'fs';

import webpackPaths from '../configs/webpack/webpack.paths';

const { srcNodeModulesPath } = webpackPaths;
const { appNodeModulesPath } = webpackPaths;

// `lstat` rather than `existsSync`, which follows the link: a symlink whose
// target is gone reads as absent, the guard passes, and `symlinkSync` then
// throws EEXIST on the link itself. Nothing in the repo recovers from that,
// so every later `npm install` fails at postinstall.
const srcLink = fs.lstatSync(srcNodeModulesPath, { throwIfNoEntry: false });
if (srcLink?.isSymbolicLink() && !fs.existsSync(srcNodeModulesPath)) {
  fs.unlinkSync(srcNodeModulesPath);
}

if (!fs.existsSync(srcNodeModulesPath) && fs.existsSync(appNodeModulesPath)) {
  fs.symlinkSync(appNodeModulesPath, srcNodeModulesPath, 'junction');
}
