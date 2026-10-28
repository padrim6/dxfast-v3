// Build de arquivo unico para publicar como artifact (um HTML autossuficiente).
// Nao altera a config de desenvolvimento. Proibido o caractere traco-longo.
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss(), viteSingleFile()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      outDir: 'dist-single',
      chunkSizeWarningLimit: 20000,
    },
  };
});
