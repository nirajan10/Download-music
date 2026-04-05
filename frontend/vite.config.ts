import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In Docker the backend is accessible at http://backend:8000.
// For local dev outside Docker change the target to http://localhost:8000.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://backend:8000",
        changeOrigin: true,
      },
    },
  },
});
