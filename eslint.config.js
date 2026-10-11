import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
  },
  {
    // The domain layer stays framework-free (SPEC 01, SPEC 02).
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'src/domain must not depend on React.' },
            { name: 'react-dom', message: 'src/domain must not depend on React.' },
            { name: 'dexie', message: 'src/domain must not depend on storage.' },
            { name: 'zustand', message: 'src/domain must not depend on UI state.' },
          ],
          patterns: [
            { group: ['react/*', 'react-dom/*'], message: 'src/domain must not depend on React.' },
            { group: ['@mantine/*'], message: 'src/domain must not depend on Mantine.' },
            { group: ['dexie/*'], message: 'src/domain must not depend on storage.' },
            { group: ['zustand/*'], message: 'src/domain must not depend on UI state.' },
          ],
        },
      ],
    },
  },
  prettier,
);
