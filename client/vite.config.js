import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectPath = '/Evaluation%20System/server/api/index.php';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost',
        changeOrigin: false,
        rewrite(path) {
          const queryIndex = path.indexOf('?');
          const route = path.slice(0, queryIndex < 0 ? undefined : queryIndex);
          const query = queryIndex < 0 ? '' : path.slice(queryIndex + 1);
          const apiRoute = route.replace(/^\/api\/?/, '/');
          return `${projectPath}?path=${encodeURIComponent(apiRoute)}${query ? `&${query}` : ''}`;
        },
      },
    },
  },
});
