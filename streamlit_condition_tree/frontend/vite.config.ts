import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  base: "./",
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: "build",
    cssMinify: false,
    lib: {
      entry: "src/index.tsx",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      output: {
        assetFileNames: "[name][extname]",
        inlineDynamicImports: true,
      },
    },
  },
  server: { port: 3001 },
})
