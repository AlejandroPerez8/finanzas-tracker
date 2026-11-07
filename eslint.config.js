const navegador = { window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly', indexedDB: 'readonly', fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', AbortController: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly', FileReader: 'readonly', Notification: 'readonly', crypto: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', btoa: 'readonly', atob: 'readonly', console: 'readonly', alert: 'readonly', confirm: 'readonly', location: 'readonly', process: 'readonly', Buffer: 'readonly', self: 'readonly', caches: 'readonly' };
export default [
  { ignores: ['node_modules/', 'coverage/', 'js/app.js'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: navegador },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
