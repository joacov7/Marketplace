// ESLint (flat config) para el monorepo. Objetivo: atrapar bugs reales y, sobre todo,
// hacer respetar los LÍMITES DE MÓDULOS (la regla de dependencias del core agnóstico):
//
//   contracts  →  (nada)                      base pura, no depende de nadie
//   platform   →  contracts                   tenancy, config, db, outbox
//   modules    →  contracts, platform         catálogo, órdenes, pagos, delivery…
//   apps/web   →  todo                         la app puede usar cualquier paquete
//
// Una importación "hacia arriba" (p. ej. platform importando modules, o modules importando
// la app) es el error que, con el tiempo, vuelve el proyecto imposible de mantener. Acá
// falla el lint (y el CI) antes de que entre.
//
// El resto son reglas de correctitud (no de estilo). Lo ruidoso queda en "warn": marca sin
// romper el build. Regenerar/instalar no hace falta: `npm run lint`.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

/** Mensaje de error de boundary reutilizable. */
const boundary = (pkg, allowed) =>
  `Límite de módulos: ${pkg} solo puede importar ${allowed}. Una dependencia hacia arriba rompe el core agnóstico (ver eslint.config.mjs).`;

export default tseslint.config(
  {
    // No lintear artefactos, dependencias ni código generado.
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/*.generated.ts",
      "**/coverage/**",
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Reglas base: correctitud, no estilo.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // `any` puntual es una decisión, no un bug: avisamos, no rompemos.
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
  {
    // contracts: base pura. No puede importar ningún otro paquete del monorepo.
    files: ["packages/contracts/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@commerce/platform", "@commerce/platform/*", "@commerce/modules", "@commerce/modules/*", "@commerce/web", "@commerce/web/*"], message: boundary("contracts", "nada (es la base)") },
          ],
        },
      ],
    },
  },
  {
    // platform: solo contracts.
    files: ["packages/platform/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@commerce/modules", "@commerce/modules/*", "@commerce/web", "@commerce/web/*"], message: boundary("platform", "contracts") },
          ],
        },
      ],
    },
  },
  {
    // modules: contracts + platform (no la app).
    files: ["packages/modules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@commerce/web", "@commerce/web/*"], message: boundary("modules", "contracts y platform") },
          ],
        },
      ],
    },
  },
  {
    // apps/web (Next.js): reglas de Next + hooks de React. Valida los `// eslint-disable`
    // que el código ya trae (img sin next/image, deps de useEffect) y chequea los hooks.
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // App Router no usa pages/_document.js: las fuentes van por <link> en el layout.
      // Esta regla asume el Pages Router viejo → falso positivo acá.
      "@next/next/no-page-custom-font": "off",
      // Idem: no hay carpeta pages/, así que esta regla solo imprime un aviso inútil.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    // Tests: menos estrictos con lo ruidoso (fixtures, helpers).
    files: ["**/*.{test,spec}.{ts,tsx}", "**/testsupport.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
