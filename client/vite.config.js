import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import fs from 'fs';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 8888,
    https: {
      key: fs.readFileSync('./localhost.key'),
      cert: fs.readFileSync('./localhost.crt')
    }
  }
});
