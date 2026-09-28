require('esbuild').buildSync({
  entryPoints: ['/work/tests/requirement-details/visual-entry.tsx'],
  outfile: '/output/visual-entry.js', bundle: true, platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
  alias: { 'react-native': '/work/node_modules/react-native-web/dist/index.js', 'react-native-safe-area-context': '/work/tests/requirement-details/web-insets.tsx' },
});
