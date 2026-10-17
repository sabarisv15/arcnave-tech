// ESLint for the frontend (P21, Stage 20 VS-33, ADR-0082). `npm run lint` must report zero errors;
// rules set to `warn` below are deliberate, with their counts in ADR-0082.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'scripts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // An empty catch hides a failure; say why in a comment, or handle it.
      'no-empty': ['error', { allowEmptyCatch: false }],
      // The browser never talks to a model provider: every model call is the backend's.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@anthropic-ai/sdk', '@anthropic-ai/sdk/*', '@google/genai', '@google/genai/*'],
              message: 'Model SDKs are never imported in the frontend; the backend calls the providers.',
            },
          ],
        },
      ],
      // Deliberate warnings (ADR-0082 has the counts): cleanups, not defects.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
);
