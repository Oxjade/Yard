import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The raw PGlite handle: only src/server/db/** may reach it. Everything else goes through
// db()/withTx() from "@/server/db", so no query ever runs beside an open transaction (§1.3).
const dbClient = {
  group: ["@/server/db/client", "**/server/db/client", "**/db/client"],
  message: "Use db() or withTx() from '@/server/db'. Only src/server/db/** may import the client.",
};
// Sealed OAuth tokens: only the social service reads them (§5.5).
const socialTokens = {
  group: ["@/server/db/schema/social-tokens", "**/schema/social-tokens"],
  message: "social_tokens is readable only inside src/server/social/**.",
};
// src/lib is isomorphic: it never imports the server tree.
const serverTree = {
  group: ["@/server/*", "@/server/**", "**/server/**"],
  message: "src/lib/** is isomorphic and must not import src/server/**.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx,mts}"],
    ignores: ["src/server/db/**", "src/server/social/**", "src/lib/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [dbClient, socialTokens] }] },
  },
  {
    files: ["src/server/social/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [dbClient] }] },
  },
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [dbClient, socialTokens, serverTree] }] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
