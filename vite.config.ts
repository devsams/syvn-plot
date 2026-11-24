import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

import { aiRoutes } from "./server/routes"

export default defineConfig(({ mode }) => ({
  plugins: [react(), aiRoutes(loadEnv(mode, process.cwd(), ""))],
}))
