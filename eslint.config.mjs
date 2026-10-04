// Correctness-focused lint rules for the dependency-free source. Run with ESLint 9+:
//   npm run lint   (npx eslint@10.1.0 .)
// The style of the dense numerical code is intentional; these rules target defects.
const browser = {window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', history: 'readonly', localStorage: 'readonly',
  matchMedia: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  performance: 'readonly', devicePixelRatio: 'readonly', ResizeObserver: 'readonly', MutationObserver: 'readonly', Worker: 'readonly', Blob: 'readonly', File: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', ImageData: 'readonly', createImageBitmap: 'readonly', OffscreenCanvas: 'readonly', MessageChannel: 'readonly',
  DOMException: 'readonly', Event: 'readonly', fetch: 'readonly', console: 'readonly', globalThis: 'readonly', queueMicrotask: 'readonly', Response: 'readonly', caches: 'readonly', self: 'readonly'};
const tetra = {createFixed: 'readonly', TetraCore: 'readonly', TetraReference: 'readonly', TetraGPU: 'readonly', TetraRender: 'readonly', TetraSaved: 'readonly'};
const rules = {
  'no-undef': 'error', 'no-unused-vars': ['error', {args: 'none', caughtErrors: 'none'}], 'no-redeclare': 'error', 'no-dupe-keys': 'error',
  'no-unreachable': 'error', 'no-self-assign': 'error', 'no-self-compare': 'error', 'no-unsafe-finally': 'error', 'no-const-assign': 'error',
  'no-dupe-else-if': 'error', 'no-duplicate-case': 'error', 'no-fallthrough': 'error', 'use-isnan': 'error', 'valid-typeof': 'error',
  'no-sparse-arrays': 'error', 'no-unsafe-negation': 'error', 'no-loss-of-precision': 'error', 'no-constant-binary-expression': 'error',
  'no-unmodified-loop-condition': 'error', 'no-use-before-define': ['error', {functions: false, classes: false, variables: false}], 'eqeqeq': ['error', 'always', {null: 'ignore'}],
};
export default [
  {ignores: ['dist/**', 'node_modules/**', 'tests/review-output/**']},
  {files: ['src/**/*.js'], languageOptions: {ecmaVersion: 2023, sourceType: 'script', globals: {...browser, ...tetra, module: 'readonly', __WORKER_SOURCE__: 'readonly'}}, rules},
  {files: ['tests/browser_pixels.js'], languageOptions: {ecmaVersion: 2023, sourceType: 'script', globals: {...browser, ...tetra}}, rules},
  {files: ['**/*.cjs'], languageOptions: {ecmaVersion: 2023, sourceType: 'commonjs', globals: {require: 'readonly', module: 'writable', __dirname: 'readonly', process: 'readonly', console: 'readonly', Buffer: 'readonly', global: 'writable', globalThis: 'readonly', performance: 'readonly', setTimeout: 'readonly', URL: 'readonly'}}, rules},
];
