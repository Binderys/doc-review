// Bundle the source-only workspace packages into the server output instead of
// externalizing them. They export TypeScript source (`exports: "./src/index.ts"`), so a
// runtime `require` of them under Node's native ESM rejects their extensionless/directory
// re-exports (ERR_UNSUPPORTED_DIR_IMPORT / ERR_MODULE_NOT_FOUND) - the compiled boot smoke
// (test:e2e) exercises exactly that. Bundling lets webpack resolve their source at build
// time, the same reason @doc-review/api-contracts was already inlined. Everything else stays
// external (real node_modules with their own resolvable entry points).
const BUNDLED_WORKSPACE_PACKAGES = new Set([
  "@doc-review/api-contracts",
  "@doc-review/shared",
]);

module.exports = (config) => {
  const [externalizeNodeModules] = config.externals;

  return {
    ...config,
    externals: [
      (context, callback) =>
        BUNDLED_WORKSPACE_PACKAGES.has(context.request)
          ? callback()
          : externalizeNodeModules(context, callback),
    ],
  };
};
