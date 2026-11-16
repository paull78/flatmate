// Ring rules from docs/architecture.md: dependencies point inward only.
//   web ──► editor ──► domain ──► protocol;  server/app ──► protocol;  only the domain-validator adapter imports domain.
//   @fm/export and @fm/render read the editor and protocol entries; only shells import them.
// Workspace packages resolve through node_modules symlinks to their real paths (packages/<name>/src/...),
// so the rules match on real paths.
const CORES = "^packages/(protocol|domain|editor|export|render)/src/";

const SPLIT_FILES = [
  "^packages/editor/src/view/(scene|labels|refused-overlay)\\.ts$",
  "^packages/editor/src/view/scene-[a-z]+\\.ts$",
  "^packages/editor/src/tools/drag[a-z-]*\\.ts$",
  "^packages/mcp/src/(tools|tool-kit|tool-types)\\.ts$",
  "^packages/mcp/src/[a-z]+-tools\\.ts$",
];

module.exports = {
  forbidden: [
    {
      name: "no-unresolvable",
      comment:
        "A dependency that cannot be resolved would silently escape every rule below. The one exception is Vite's URL " +
        "import of the editor's bundled font file (render.15), an asset, not a module; the next rule confines it.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true, pathNot: "^@fm/editor/fonts/Inter-Regular\\.ttf\\?url$" },
    },
    {
      name: "no-unresolvable-but-the-font-url",
      comment: "Vite's URL import of the editor's bundled font (render.15) resolves only in the web shell's font adapter.",
      severity: "error",
      from: { pathNot: "^packages/web/src/adapters/fonts\\.ts$" },
      to: { couldNotResolve: true, path: "^@fm/editor/fonts/Inter-Regular\\.ttf\\?url$" },
    },
    {
      name: "protocol-is-innermost",
      severity: "error",
      from: { path: "^packages/protocol/src/" },
      to: { path: "^packages/(domain|editor|export|render|web|server|sync-tests)/" },
    },
    {
      name: "domain-imports-protocol-only",
      severity: "error",
      from: { path: "^packages/domain/src/" },
      to: { path: "^packages/(editor|export|render|web|server|sync-tests)/" },
    },
    {
      name: "editor-imports-domain-and-protocol-only",
      severity: "error",
      from: { path: "^packages/editor/src/" },
      to: { path: "^packages/(export|render|web|server|sync-tests)/" },
    },
    {
      // A whitelist: its own files and the protocol's entry, so an adapter, `ws` or main can't get in. Node built-ins are
      // allowed (docs/architecture.md), and a rule for them would need another dependency type.
      name: "server-app-is-inside",
      severity: "error",
      from: { path: "^packages/server/src/app/" },
      to: {
        dependencyTypes: ["local", "npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled", "npm-no-pkg", "npm-unknown"],
        pathNot: ["^packages/server/src/app/", "^packages/protocol/src/index\\.ts$"],
      },
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
      to: { path: "^packages/(editor|render|web|sync-tests)/" },
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
      comment: "scripts/ is the cli shell (spec: overview): it uses the domain API through the package entries only.",
      severity: "error",
      from: { path: "^scripts/" },
      to: { path: "^packages/", pathNot: "^packages/(domain|protocol)/src/index\\.ts$" },
    },
    {
      name: "mcp-imports-cores-only",
      comment: "packages/mcp is a shell (spec: mcp): it uses protocol, domain, editor, export and render (look's raster3d, real3d.11) through their entries, never the server, web or test harnesses.",
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
      name: "web-imports-editor-and-protocol-only",
      comment: "The web shell reaches the core through the editor (spec: overview, arch-review R-10), and the file and render formats through @fm/export and @fm/render, never the domain or the editor's test harness.",
      severity: "error",
      from: { path: "^packages/web/src/" },
      to: { path: "^packages/domain/|^packages/editor/test/" },
    },
    {
      name: "panels-render-viewmodel-only",
      comment: "Panels render the ViewModel and send ui events; they never touch the store, the app wiring or the adapters.",
      severity: "error",
      from: { path: "^packages/web/src/panels/" },
      to: { path: "^packages/web/src/(store|main|app)\\.tsx?$|^packages/web/src/adapters/" },
    },
    {
      name: "renderers-are-scene-interpreters",
      comment: "The Canvas2D, WebGL and WebGPU renderers and the GPU layer cache draw a Scene with a Camera: the editor, protocol and render entries and each other only.",
      severity: "error",
      from: { path: "^packages/web/src/adapters/(canvas2d-renderer|webgl-renderer|webgpu-renderer|gpu-layers)\\.ts$|^packages/web/src/adapters/(webgl|webgpu)/" },
      to: {
        pathNot: [
          "^packages/(editor|protocol|render)/src/index\\.ts$",
          "^packages/web/src/adapters/(canvas2d-renderer|webgl-renderer|webgpu-renderer|renderer|gpu-layers)\\.ts$",
          "^packages/web/src/adapters/(webgl|webgpu)/",
        ],
      },
    },
    {
      name: "editor-ports-import-types-only",
      comment: "Port contracts are leaves: inside the editor they import only type modules, so a new host compiles against them alone.",
      severity: "error",
      from: { path: "^packages/editor/src/ports/" },
      to: {
        path: "^packages/editor/src/",
        pathNot: ["^packages/editor/src/ports/", "^packages/editor/src/view/[^/]*-types\\.ts$", "^packages/editor/src/(types|camera|view3d/types)\\.ts$"],
      },
    },
    {
      name: "renderers3d-are-view3d-interpreters",
      comment:
        "The web 3D adapter draws the editor's plain 3D frame and nothing else (heights.30): only the editor, protocol " +
        "and render entries and the renderer3d port, so another renderer can replace it (real3d.10).",
      severity: "error",
      from: { path: "^packages/web/src/adapters/webgl3d-renderer\\.ts$" },
      to: {
        pathNot: [
          "^packages/(editor|protocol|render)/src/index\\.ts$",
          "^packages/web/src/adapters/renderer3d\\.ts$",
        ],
      },
    },
    {
      name: "no-new-cycles",
      comment:
        "A ratchet (fixes AC-16): today's import cycles are listed in .dependency-cruiser-known-violations.json, and any other " +
        "fails. Removing a cycle needs nothing. After a change that only reroutes a known one: pnpm depcruise:baseline.",
      severity: "error",
      from: { path: "^packages/[^/]+/src/" },
      to: { circular: true },
    },
    {
      name: "drawing-layers-stateless",
      comment:
        "Document drawing layers are functions of the document, layout and zoom, not of the session (arch-review.12): " +
        "export, side-by-side layouts and stacked levels will need them without an EditorState. The 3D view's items, " +
        "camera and faces and the flip poses too: the stage 3 PDF and a native shell build the 3D picture alone (heights.29). " +
        "Checked transitively, so a layer can't reach the session through a module in between (levels.46).",
      severity: "error",
      from: { path: "^packages/editor/src/(view/([a-z-]+-layer|rings|tags|furniture|symbols/[^/]+|palette|picture|plan-style|plan-view|dimension-layout|look|look-rulers|flip-poses)\\.ts$|view3d/)" },
      to: { path: "^packages/editor/src/((state|session|update|commit|levels)\\.ts$|tools/)", reachable: true },
    },
    {
      name: "symbol-groups-acyclic",
      comment: "Symbol group files import each other one way only (sleep.ts uses sit-and-eat.ts's table and desk, never back).",
      severity: "error",
      from: { path: "^packages/editor/src/view/symbols/" },
      to: { circular: true },
    },
    {
      name: "split-files-acyclic",
      comment:
        "Files split from one by concern (tidy C2) never import back from each other in a ring: scene.ts and its scene-* " +
        "parts, labels and the refused overlay, tools/drag*.ts, and MCP's tools.ts with its kit, types and groups (tidy.16). " +
        "viaOnly: drag.ts already sits on older editor cycles through state.ts; only rings within these files count.",
      severity: "error",
      from: { path: SPLIT_FILES },
      to: { circular: true, viaOnly: { path: SPLIT_FILES } },
    },
    {
      name: "export-imports-editor-and-protocol-only",
      comment:
        "@fm/export translates the editor's export data into file formats (export.17): it reads editor and protocol types " +
        "through their entries and nothing else; only shells import it.",
      severity: "error",
      from: { path: "^packages/export/src/" },
      to: { path: "^packages/", pathNot: ["^packages/export/", "^packages/(editor|protocol)/src/index\\.ts$"] },
    },
    {
      name: "render-imports-editor-and-protocol-only",
      comment:
        "@fm/render turns a Scene into the render format's buffers (render.14): it reads the editor and protocol through " +
        "their entries and earcut, nothing else; only shells import it.",
      severity: "error",
      from: { path: "^packages/render/src/" },
      to: { path: "^packages/", pathNot: ["^packages/render/", "^packages/(editor|protocol)/src/index\\.ts$"] },
    },
    {
      name: "only-shells-import-render",
      severity: "error",
      from: { path: "^packages/(protocol|domain|editor|export|server)/" },
      to: { path: "^packages/render/" },
    },
    {
      name: "only-shells-import-export",
      severity: "error",
      from: { path: "^packages/(protocol|domain|editor|server)/" },
      to: { path: "^packages/export/" },
    },
    {
      name: "cores-no-node-builtins",
      severity: "error",
      from: { path: CORES },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "cores-no-third-party-packages",
      comment:
        "Core sources depend on nothing outside the workspace (no React, ws, …); @fm/render alone may use earcut, plain " +
        "IEEE arithmetic with its own types, so a native shell needs no triangulator (render.14).",
      severity: "error",
      from: { path: CORES },
      to: { path: "node_modules", pathNot: "node_modules/earcut/" },
    },
    {
      name: "only-render-uses-earcut",
      comment: "Triangulation belongs to the render format (render.14, webgpu.09): no other package, core or shell, imports earcut.",
      severity: "error",
      from: { path: "^packages/", pathNot: "^packages/render/(src|test)/" },
      to: { path: "node_modules/earcut/" },
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
