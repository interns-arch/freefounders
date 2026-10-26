// Metro for the Kaampilot phone app (the web app in a native shell, PLAN.md §19.17). apps/mobile is NOT in the root
// npm workspace: it keeps its own node_modules (Expo pins its own React). The only shared code it reads is the theme's
// hex colours, straight from source:  @kaampilot/theme/native  →  ../../packages/theme  (through its "exports").
// Any bare import made inside packages/* would be taken from THIS app's node_modules (one React). See README.md.
const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '../..');
const SHARED = {
  '@kaampilot/theme': path.join(repoRoot, 'packages/theme'),
};
const sharedDirs = Object.values(SHARED);

/** '@kaampilot/theme/native' → the file its package.json "exports" names for './native'. */
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
// tsconfig.json "paths" are for TypeScript only, so Expo's own tsconfig-paths resolution is switched off in app.json and
// the app's `@/` alias is resolved here instead.
const ALIASES = [
  ['@/assets/', path.join(projectRoot, 'assets') + path.sep],
  ['@/', path.join(projectRoot, 'src') + path.sep],
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const alias = ALIASES.find(([prefix]) => moduleName.startsWith(prefix));
  if (alias) return context.resolveRequest(context, alias[1] + moduleName.slice(alias[0].length), platform);
  const file = sharedFile(moduleName);
  if (file) return { type: 'sourceFile', filePath: file };
  // A bare import inside packages/* resolves as if the app imported it.
  const fromShared = sharedDirs.some((d) => context.originModulePath.startsWith(d + path.sep));
  const bare = !moduleName.startsWith('.') && !path.isAbsolute(moduleName);
  if (fromShared && bare) return context.resolveRequest({ ...context, originModulePath: fromApp }, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
