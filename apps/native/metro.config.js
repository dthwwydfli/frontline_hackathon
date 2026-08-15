// Metro in a pnpm monorepo.
//
// Two problems have to be solved together here:
//
// 1. Resolution. pnpm links dependencies through a store at the repo root, so
//    Metro must watch the root and look in both node_modules folders.
//
// 2. Duplicate React. Watching the root means react/react-native exist in two
//    places (root and apps/native). React is a singleton — two copies produce
//    "Invalid hook call ... more than one copy of React in the same app", then
//    "Cannot read property 'useState' of null". Pinning them below forces every
//    import to the same instance.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const localModules = path.resolve(projectRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  localModules,
  path.resolve(workspaceRoot, 'node_modules'),
];

// Follow the store symlinks rather than treating each as an opaque file.
config.resolver.unstable_enableSymlinks = true;

// Hierarchical lookup stays ON. pnpm nests each package's own dependencies
// under its store folder, so a package resolving its peers (expo-modules-core
// and friends) walks up from its own directory.
config.resolver.disableHierarchicalLookup = false;

// Anything that must exist exactly once in the bundle.
const SINGLETONS = ['react', 'react-dom', 'react-native'];

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  ...Object.fromEntries(
    SINGLETONS.map((name) => [name, path.resolve(localModules, name)]),
  ),
};

// extraNodeModules alone does not cover deep imports such as
// "react-native/Libraries/...", which is how a second copy sneaks back in.
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const singleton = SINGLETONS.find(
    (name) => moduleName === name || moduleName.startsWith(`${name}/`),
  );

  if (singleton !== undefined) {
    const rest = moduleName.slice(singleton.length);
    return context.resolveRequest(
      context,
      path.resolve(localModules, singleton) + rest,
      platform,
    );
  }

  return defaultResolveRequest === undefined
    ? context.resolveRequest(context, moduleName, platform)
    : defaultResolveRequest(context, moduleName, platform);
};

module.exports = config;
