import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

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
			obsidian: resolve(process.cwd(), 'tests/stubs/obsidian.ts'),
		},
	},
})