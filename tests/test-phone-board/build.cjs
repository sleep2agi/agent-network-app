// Isolated fixture bundle: RequirementBoard on react-native-web, no hub (drive.mjs serves a read-only /api stub).
const root = process.env.APP_ROOT || '/app';
require('esbuild').buildSync({
 entryPoints:[`${root}/tests/test-phone-board/entry.jsx`],outfile:process.env.BUNDLE_OUT||'/phone-board.js',bundle:true,platform:'browser',jsx:'automatic',
 loader:{'.js':'jsx','.png':'dataurl','.webp':'dataurl','.ttf':'dataurl'},
 resolveExtensions:['.web.tsx','.web.ts','.web.jsx','.web.js','.tsx','.ts','.jsx','.js','.json'],
 define:{'process.env.NODE_ENV':'"production"','process.env':'{}',__DEV__:'false'},
 alias:{'react-native':`${root}/node_modules/react-native-web/dist/index.js`,'react-native-safe-area-context':`${root}/tests/requirement-details/web-insets.tsx`},
});
