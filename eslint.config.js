import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Core packages (docs/architecture.md, AGENTS.md): no type assertions and no non-null assertions.
// `as const` is not a type assertion for this rule and stays allowed.
const CORE_SOURCES = ["packages/{protocol,domain,editor,export,render,mcp}/src/**/*.ts", "packages/server/src/app/**/*.ts"];

// no-restricted-syntax entries. A later config block replaces an earlier block's options for the same rule, so a block
// lists every entry that applies to its files.
const NO_KIND_CONFIGS = {
  selector: "MemberExpression[property.name='configs']",
  message: "Read configurations through kindConfigs / configsOf / configOf in domain/src/kinds.ts (arch-review R-04).",
};
// The opening kind ids, as OPENING_KIND_IDS in domain/src/opening-kinds.ts lists them; scripts/test/kind-guard.test.ts
// holds the two lists equal, so a kind added to the table can't slip past the guard (openkinds AC-14).
const OPENING_KIND_ID_LIST = ["swing", "double", "sliding", "pocket", "folding", "slidingGlass", "window", "casement", "twoLeaf", "passage", "curtain"];
const KIND_ID = `/^(${OPENING_KIND_ID_LIST.join("|")})$/`;
const NO_KIND_LITERALS = {
  selector: `BinaryExpression > Literal[value=${KIND_ID}], ArrayExpression > Literal[value=${KIND_ID}]`,
  message: "Compare or list opening kinds through OPENING_KINDS / isOpeningKind in domain/src/kinds.ts (arch-review R-01).",
};
const NO_MESSAGE_PARSING = {
  selector: "CallExpression[callee.object.property.name='message'][callee.property.name=/^(startsWith|endsWith|split|includes|slice|match|indexOf|replace)$/]",
  message: "Don't parse an error message; read the violations (arch-review R-09).",
};

// The domain alone resolves heights (heights.27, .30): queries/vertical.ts reads the ceiling row and the h and z maps.
const NO_CEILING_ROW = {
  selector: "MemberExpression[property.name='ceilings']",
  message: "Read the ceiling through ceilingHeight / ceilingOver / ceilingAlong in @fm/domain (heights.27).",
};
const NO_HEIGHT_MAP_READ = {
  selector: "MemberExpression[computed=true][object.type='MemberExpression'][object.property.name=/^(h|z)$/]",
  message: "Read heights and elevations through heightsOf / placementRange / presetSize in @fm/domain (heights.27, catalog.17).",
};

// The domain alone reads the deck rows (decks.16): everything else goes through deckViews / deckView. Narrowed to a
// document's table, so a picture's or a count's `decks` field passes.
const NO_DECK_TABLE = {
  selector: "MemberExpression[property.name=/^(decks|deckHoles)$/]:matches([object.name=/^(doc|document)$/], [object.property.name=/^(doc|document)$/])",
  message: "Read decks and their holes through deckViews / deckView in @fm/domain (decks.16, stairwell.15).",
};

// The domain alone reads the sheet rows (sheetset.02): no rows means the automatic list, which only sheetsOf knows.
const NO_SHEET_TABLE = {
  selector: "MemberExpression[property.name='sheets']:matches([object.name=/^(doc|document)$/], [object.property.name=/^(doc|document)$/])",
  message: "Read the sheet list through sheetsOf in @fm/domain: no rows means the automatic list (sheetset.02).",
};

// The editor draws and snaps at the viewed level's cut, never the floor's (levels.16): `planPicture` and the scene
// resolve the view once and pass it in. Any `cutHeight` name in the editor, imported, called or read off a namespace,
// is reported.
const NO_CUT_HEIGHT = {
  selector: "Identifier[name='cutHeight']",
  message: "The editor takes the cut from a PlanView or a Level (view/plan-view.ts), not from cutHeight (levels.16).",
};

// Doors and windows have one copy of their heights, in the domain (levels.05): the plan and the 3D view read openingRange, a
// new opening defaultOpeningHeights (sills.01). HEAD_CLEAR, the wall a head keeps, is the fit rule's and may be read (sills.02).
const NO_OPENING_HEIGHTS = {
  selector: "Identifier[name=/^(DOOR_HEAD|WINDOW_SILL|WINDOW_HEAD)$/]",
  message: "Opening heights live in @fm/domain's queries/vertical.ts: read them through openingRange or defaultOpeningHeights (levels.05, sills.01).",
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "data/**",
      ".claude/worktrees/**",
      "packages/web/dist/**",
      "packages/web/test-results/**",
      "packages/web/playwright-report/**",
      "recordings/**", // the private recording rig (samples.06): not published, not part of the app
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // CommonJS config files such as .dependency-cruiser.cjs
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { module: "writable", require: "readonly" } },
  },
  {
    files: CORE_SOURCES,
    rules: {
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    // AGENTS.md: exhaustive switches. Typed lint, so a switch over a union must name every member (arch-review R-10).
    files: ["packages/{protocol,domain,editor,export,render,mcp}/src/**/*.ts", "packages/server/src/app/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: { "@typescript-eslint/switch-exhaustiveness-check": "error" },
  },
  {
    // A module that outgrows this is collecting concerns (arch-review R-12 split queries/layout.ts; the editor since
    // tidy C2 split view/scene.ts and tools/drag.ts).
    files: ["packages/{domain,editor,render}/src/**/*.ts"],
    rules: { "max-lines": ["error", { max: 250, skipBlankLines: true, skipComments: true }] },
  },
  {
    // An object's configurations and the opening kinds are each defined in one place (arch-review R-04, R-01).
    files: ["packages/*/src/**/*.{ts,tsx}"],
    ignores: ["packages/domain/src/kinds.ts", "packages/domain/src/opening-kinds.ts"],
    rules: { "no-restricted-syntax": ["error", NO_KIND_CONFIGS, NO_KIND_LITERALS, NO_OPENING_HEIGHTS] },
  },
  {
    // The domain owns the opening heights (levels.05): the block above less NO_OPENING_HEIGHTS.
    files: ["packages/domain/src/**/*.ts"],
    ignores: ["packages/domain/src/kinds.ts", "packages/domain/src/opening-kinds.ts"],
    rules: { "no-restricted-syntax": ["error", NO_KIND_CONFIGS, NO_KIND_LITERALS] },
  },
  {
    // Outside the domain, heights and decks come from its queries (heights.30, decks.16).
    files: ["packages/{mcp,export,web}/src/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", NO_KIND_CONFIGS, NO_KIND_LITERALS, NO_CEILING_ROW, NO_HEIGHT_MAP_READ, NO_DECK_TABLE, NO_SHEET_TABLE, NO_OPENING_HEIGHTS] },
  },
  {
    // Refusals are data: the editor builds texts from violations and commands, never by parsing a message (arch-review R-09);
    // the cut comes from the plan view or the viewed level, never cutHeight (levels.16).
    files: ["packages/editor/src/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", NO_KIND_CONFIGS, NO_KIND_LITERALS, NO_MESSAGE_PARSING, NO_CEILING_ROW, NO_HEIGHT_MAP_READ, NO_DECK_TABLE, NO_SHEET_TABLE, NO_OPENING_HEIGHTS, NO_CUT_HEIGHT],
    },
  },
  {
    // The MCP server speaks JSON-RPC on stdout: logging goes to stderr (console.error / console.warn) only.
    files: ["packages/mcp/src/**/*.ts"],
    rules: {
      "no-console": ["error", { allow: ["error", "warn"] }],
      // Positions are stored to the millimetre like a click with the Object tool (spec: mcp, arch-review R-02).
      "no-restricted-imports": ["error", { paths: [{ name: "@fm/domain", importNames: ["anchorAt"], message: "Use anchorAtMm: stored anchors are kept to the millimetre." }] }],
    },
  },
  {
    // Extension-point stubs keep their final signature; unused parameters start with "_".
    // Only parameters are exempt: an unused `_` variable is still reported.
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
