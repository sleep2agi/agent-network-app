require('esbuild').buildSync({
 entryPoints:['tests/node-adoption/entry.jsx'],outfile:'/node-adoption.js',bundle:true,platform:'browser',jsx:'automatic',
 loader:{'.js':'jsx','.png':'dataurl','.webp':'dataurl','.ttf':'dataurl'},
 resolveExtensions:['.web.tsx','.web.ts','.web.jsx','.web.js','.tsx','.ts','.jsx','.js','.json'],
 define:{'process.env.NODE_ENV':'"production"','process.env':'{}',__DEV__:'false'},
 alias:{'react-native':'/app/node_modules/react-native-web/dist/index.js'},
});
