import {build} from 'vite';
await build({configFile:false,base:'/socioscope-ulm/',build:{outDir:'docs',emptyOutDir:true,target:'es2022'},esbuild:{jsx:'automatic'},define:{'process.env.NODE_ENV':'"production"'}});
