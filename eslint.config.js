import js from "@eslint/js";
import globals from "globals";

const noUnusedVars = ["error", {
  args: "none",
  caughtErrors: "none",
  ignoreRestSiblings: true
}];

export default [
  {
    ignores: ["dist/**", "node_modules/**", "geo/**"]
  },
  js.configs.recommended,
  {
    // Browser client
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        google: "readonly",
        turf: "readonly"
      }
    },
    rules: {
      "no-unused-vars": noUnusedVars,
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  },
  {
    // Node tooling and tests
    files: [
      "scripts/**/*.mjs",
      "tests/**/*.mjs",
      "*.config.js",
      "eslint.config.js"
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node }
    },
    rules: {
      "no-unused-vars": noUnusedVars,
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  },
  {
    // Playwright end-to-end specs run in Node, but their in-page callbacks
    // (page.evaluate / waitForFunction) execute in the browser.
    files: ["tests/e2e/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      "no-unused-vars": noUnusedVars,
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  }
];
