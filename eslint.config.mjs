import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

const config = [
  {
    ignores: ['.next/**', 'out/**', 'dist/**', 'coverage/**']
  },
  ...nextCoreWebVitals,
  prettierRecommended,
  {
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      // TanStack Table intentionally exposes non-memoizable functions; React Compiler safely skips those components.
      'react-hooks/incompatible-library': 'off',
      'no-debugger': 'error'
    }
  }
];

export default config;
