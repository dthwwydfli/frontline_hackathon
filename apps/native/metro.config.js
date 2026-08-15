// Metro in a pnpm monorepo.
//
// pnpm symlinks every dependency into the store at the repo root, so Metro has
// to watch the root and be told to resolve through both node_modules folders.
// Without this it reports "Unable to resolve module ..." for packages that are
// installed and present on disk.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Follow the store symlinks rather than treating each as an opaque file.
config.resolver.unstable_enableSymlinks = true;
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
