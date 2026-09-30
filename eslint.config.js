import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Core packages (spec §2.4, AGENTS.md): no type assertions and no non-null assertions.
// `as const` is not a type assertion for this rule and stays allowed.
const CORE_SOURCES = ["packages/{protocol,domain,editor}/src/**/*.ts", "packages/server/src/app/**/*.ts"];

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
    // The MCP server speaks JSON-RPC on stdout: logging goes to stderr (console.error / console.warn) only.
    files: ["packages/mcp/src/**/*.ts"],
    rules: { "no-console": ["error", { allow: ["error", "warn"] }] },
  },
  {
    // Extension-point stubs keep their final signature; unused parameters start with "_".
    // Only parameters are exempt: an unused `_` variable is still reported.
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
