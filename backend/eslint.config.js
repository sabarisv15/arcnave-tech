// ESLint for the backend (P21, Stage 20 VS-33, ADR-0082). `npm run lint` must report zero errors;
// rules set to `warn` below are deliberate, with their counts in ADR-0082.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Model SDKs are called only under src/providers/ (CLAUDE.md "Forbidden"). */
const SDK_IMPORTS = {
  group: ['@anthropic-ai/sdk', '@anthropic-ai/sdk/*', '@google/genai', '@google/genai/*'],
  message: 'Model SDKs are imported only under src/providers/ (CLAUDE.md, Forbidden).',
};
/** The database is reached through the service container (D3 A-16). */
const GET_DB = {
  group: ['**/db/client.js'],
  importNames: ['getDb'],
  message: 'Take the Database from the service container (svc.db / request.services.db), not getDb() (A-16).',
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'drizzle/**', 'sandbox/**', 'skills/**', 'var/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // A-23: an empty catch hides a failure; say why with a `// benign:` comment, log, or throw.
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-restricted-imports': ['error', { patterns: [SDK_IMPORTS, GET_DB] }],
      // Deliberate warnings (ADR-0082 has the counts): existing code, mostly tests and SDK shims;
      // each is a cleanup, not a defect, and new code should not add to them.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  { files: ['src/providers/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [GET_DB] }] } },
  { files: ['src/container.ts', 'src/db/client.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [SDK_IMPORTS] }] } },
  // Tests build SDK error objects for the classifiers and may open their own pool; they never call a provider.
  { files: ['src/**/*.test.ts', 'src/test/**/*.ts'], rules: { 'no-restricted-imports': 'off' } },
);
