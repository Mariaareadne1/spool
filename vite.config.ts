import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5341,
    strictPort: true,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // offline audio renders run real DSP; the machine is often busy
    testTimeout: 60_000,
  },
} as Parameters<typeof defineConfig>[0]);
