import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    '.pytest_cache',
    '.lake',
    'MarketGRT/.lake',
    'backend',
    'backend/_vendor',
    'backend/_vendor_runtime',
    'backend/.pytest_cache',
    'backend/.local_pdfdeps',
    'backend/data',
    'node_modules',
    'artifacts',
    'logs',
    'handoff',
    'pharmacognosy-platform',
    '.venv',
    '.tmp',
    'tmp_hpc_mpi_smoke',
    'workspace-archive-*',
    'src/historical_timeline_app.jsx',
    'src/interactive_structural_analysis_view.jsx',
    'src/projective_scene.js',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
])
