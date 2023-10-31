const path = require('path');

const rootPath = path.join(__dirname, '../..');

const dllPath = path.join(__dirname, '../dll');

const srcPath = path.join(rootPath, 'src');
const srcMainPath = path.join(srcPath, 'main');
const srcRendererPath = path.join(srcPath, 'renderer');

const releasePath = path.join(rootPath, 'release');
const appPath = path.join(releasePath, 'app');
const appPackagePath = path.join(appPath, 'package.json');
const appNodeModulesPath = path.join(appPath, 'node_modules');
const srcNodeModulesPath = path.join(srcPath, 'node_modules');

const distPath = path.join(appPath, 'dist');
const distMainPath = path.join(distPath, 'main');
const distRendererPath = path.join(distPath, 'renderer');

const buildPath = path.join(releasePath, 'build');

const typesPath = path.join(srcPath, 'types');

const monacoPath = {
  'editor.worker': 'monaco-editor/esm/vs/editor/editor.worker.js',
  'json.worker': 'monaco-editor/esm/vs/language/json/json.worker',
  'css.worker': 'monaco-editor/esm/vs/language/css/css.worker',
  'html.worker': 'monaco-editor/esm/vs/language/html/html.worker',
  'ts.worker': 'monaco-editor/esm/vs/language/typescript/ts.worker',
};

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
  monacoPath,
};
