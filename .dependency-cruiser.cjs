// Ring rules from spec §2.4: dependencies point inward only.
//   web ──► editor ──► domain ──► protocol;  server/app ──► protocol;  only the domain-validator adapter imports domain.
// Workspace packages resolve through node_modules symlinks to their real paths (packages/<name>/src/...),
// so the rules match on real paths.
const CORES = "^packages/(protocol|domain|editor)/src/";

module.exports = {
  forbidden: [
    {
      name: "no-unresolvable",
      comment: "A dependency that cannot be resolved would silently escape every rule below.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "protocol-is-innermost",
      severity: "error",
      from: { path: "^packages/protocol/src/" },
      to: { path: "^packages/(domain|editor|web|server|sync-tests)/" },
    },
    {
      name: "domain-imports-protocol-only",
      severity: "error",
      from: { path: "^packages/domain/src/" },
      to: { path: "^packages/(editor|web|server|sync-tests)/" },
    },
    {
      name: "editor-imports-domain-and-protocol-only",
      severity: "error",
      from: { path: "^packages/editor/src/" },
      to: { path: "^packages/(web|server|sync-tests)/" },
    },
    {
      name: "server-app-imports-protocol-only",
      severity: "error",
      from: { path: "^packages/server/src/app/" },
      to: { path: "^packages/(domain|editor|web|sync-tests)/" },
    },
    {
      name: "only-domain-validator-imports-domain",
      severity: "error",
      from: { path: "^packages/server/src/", pathNot: "^packages/server/src/adapters/domain-validator\\.ts$" },
      to: { path: "^packages/domain/" },
    },
    {
      name: "server-never-imports-editor-or-web",
      severity: "error",
      from: { path: "^packages/server/" },
      to: { path: "^packages/(editor|web|sync-tests)/" },
    },
    {
      name: "web-never-imports-server",
      severity: "error",
      from: { path: "^packages/web/" },
      to: { path: "^packages/(server|sync-tests)/" },
    },
    {
      name: "only-through-package-index",
      comment:
        "Another workspace package is used only through its entry point (src/index.ts; plus @fm/editor/testing from phase 7). " +
        "A relative path into its internals would skip the exports map, so tsc and the bundlers would accept it.",
      severity: "error",
      from: { path: "^packages/([^/]+)/" },
      to: {
        path: "^packages/[^/]+/",
        pathNot: ["^packages/$1/", "^packages/[^/]+/src/index\\.ts$", "^packages/editor/test/testing\\.ts$"],
      },
    },
    {
      name: "scripts-import-domain-and-protocol-only",
      comment: "scripts/ is the cli shell (spec §2.2): it uses the domain API through the package entries only.",
      severity: "error",
      from: { path: "^scripts/" },
      to: { path: "^packages/", pathNot: "^packages/(domain|protocol)/src/index\\.ts$" },
    },
    {
      name: "mcp-imports-cores-only",
      comment: "packages/mcp is a shell (spec §12): it uses protocol, domain and editor through their entries, never the server, web or test harnesses.",
      severity: "error",
      from: { path: "^packages/mcp/src/" },
      to: { path: "^packages/(server|web|sync-tests)/|^packages/editor/test/" },
    },
    {
      name: "mcp-tests-use-server-entry-only",
      comment: "MCP tests run the real server app through @fm/server's entry, like sync-tests; never the web shell.",
      severity: "error",
      from: { path: "^packages/mcp/test/" },
      to: { path: "^packages/(web|sync-tests)/" },
    },
    {
      name: "nothing-imports-mcp",
      comment: "The MCP server is an outer shell: no other package depends on it.",
      severity: "error",
      from: { pathNot: "^packages/mcp/" },
      to: { path: "^packages/mcp/" },
    },
    {
      name: "cores-no-node-builtins",
      severity: "error",
      from: { path: CORES },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "cores-no-third-party-packages",
      comment: "protocol, domain and editor sources depend on nothing outside the workspace (no React, ws, …).",
      severity: "error",
      from: { path: CORES },
      to: { path: "node_modules" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};
