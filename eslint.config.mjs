import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  // Global ignores
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
  // JavaScript files (including .mjs)
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...js.configs.recommended,
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  // TypeScript files – base recommended rules
  ...tseslint.configs.recommended,
  // Custom TypeScript rules (adds project and tweaks)
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
    },
  },
  // Test files – relax strict rules
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
];