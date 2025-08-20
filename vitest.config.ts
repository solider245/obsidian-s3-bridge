import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		exclude: ['node_modules', 'dist', '.obsidian', '.git'],
		reporters: ['default'],
		globals: false,
		environment: 'node',
		coverage: {
			enabled: false,
		},
		hookTimeout: 20000,
	},
	resolve: {
		alias: {
			obsidian: resolve(__dirname, 'tests/stubs/obsidian.ts'),
		},
	},
})
