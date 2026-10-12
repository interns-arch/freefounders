// Metro for the FreeFounders phone app. apps/mobile is NOT in the root npm workspace: it keeps its own node_modules
// (Expo pins its own React, which differs from the web's). The shared code is read straight from source:
//   @freefounders/core, @freefounders/theme  →  ../../packages/*  (resolved through their package.json "exports")
// and every package those files import (react, @tanstack/react-query…) is taken from THIS app's node_modules, so the
// bundle has exactly one React. See README.md "How the monorepo is wired".
const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '../..');
const SHARED = {
  '@freefounders/core': path.join(repoRoot, 'packages/core'),
  '@freefounders/theme': path.join(repoRoot, 'packages/theme'),
};
const sharedDirs = Object.values(SHARED);

/** '@freefounders/core/hr' → the file its package.json "exports" names for './hr'. */
function sharedFile(moduleName) {
  for (const [name, dir] of Object.entries(SHARED)) {
    if (moduleName !== name && !moduleName.startsWith(`${name}/`)) continue;
    const sub = `.${moduleName.slice(name.length)}`;
    const exportsMap = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).exports ?? {};
    const target = exportsMap[sub === '.' ? '.' : sub];
    if (typeof target !== 'string') throw new Error(`${moduleName}: not exported by ${name}/package.json`);
    return path.join(dir, target);
  }
  return null;
}

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...(config.watchFolders ?? []), ...sharedDirs];
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules')];

const fromApp = path.join(projectRoot, 'package.json');
// tsconfig.json "paths" are for TypeScript only (they also point react/@tanstack/react-query at this app's copies for
// the type checker), so Expo's own tsconfig-paths resolution is switched off in app.json and the app's `@/` alias is
// resolved here instead.
const ALIASES = [
  ['@/assets/', path.join(projectRoot, 'assets') + path.sep],
  ['@/', path.join(projectRoot, 'src') + path.sep],
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const alias = ALIASES.find(([prefix]) => moduleName.startsWith(prefix));
  if (alias) return context.resolveRequest(context, alias[1] + moduleName.slice(alias[0].length), platform);
  const file = sharedFile(moduleName);
  if (file) return { type: 'sourceFile', filePath: file };
  // A bare import inside packages/* (react, @tanstack/react-query…) resolves as if the app imported it.
  const fromShared = sharedDirs.some((d) => context.originModulePath.startsWith(d + path.sep));
  const bare = !moduleName.startsWith('.') && !path.isAbsolute(moduleName);
  if (fromShared && bare) return context.resolveRequest({ ...context, originModulePath: fromApp }, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
