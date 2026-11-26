import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (normalized.includes('node_modules/three')) {
            return 'three-vendor';
          }
          if (normalized.endsWith('/src/voxelTextures.ts')) {
            return 'voxel-studio';
          }
          if (normalized.endsWith('/src/audio.ts') || normalized.endsWith('/src/localization.ts')) {
            return 'audio-i18n';
          }
          if (normalized.endsWith('/src/bsl4Lab.ts') || normalized.endsWith('/src/cityData.ts')) {
            return 'world-layout';
          }
          return undefined;
        }
      }
    }
  }
});
