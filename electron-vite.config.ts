import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          interop: ((id: string | null) => {
            if (id === 'electron') return false;
            return 'auto';
          }) as any,
        }
      },
      commonjsOptions: {
        ignoreDynamicRequires: true
      }
    },
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@': resolve('src')
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        external: ['electron', 'better-sqlite3', '@electron/remote'],
        output: {
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@main': resolve('src/main'),
        '@': resolve('src')
      }
    }
  }
});