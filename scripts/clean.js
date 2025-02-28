import fs from 'fs';
import { rimrafSync } from 'rimraf';

import webpackPaths from '../configs/webpack/webpack.paths';

const foldersToRemove = [
  webpackPaths.distPath,
  webpackPaths.buildPath,
  webpackPaths.dllPath,
  '/tmp/*.dmg'
];

foldersToRemove.forEach((folder) => {
  if (fs.existsSync(folder)) rimrafSync(folder);
});
