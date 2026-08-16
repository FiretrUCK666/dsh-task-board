/**
 * Vitest config for the standalone task-board plugin. Runs the framework-free
 * core and the pure settings route/scope layers in a Node environment; the
 * client settings scope's fetch calls are mocked per-test.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    server: {
      deps: {
        inline: [/@deepseek-ai\//],
      },
    },
  },
})
