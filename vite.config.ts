import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    // Deux pages : l'editeur, et la salle de donjon jouable qui s'en sert.
    // La demo importe `src/smart` directement — c'est ce qui garantit qu'elle
    // ne peut pas mentir sur ce que fait l'editeur.
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        demo: resolve(__dirname, 'demo.html'),
      },
    },
  },
  server: { port: 5173, host: true },
})
