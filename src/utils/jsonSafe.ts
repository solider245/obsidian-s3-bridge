export function safeJsonParse<T>(raw: string, fallback: T): T {
	try {
		return JSON.parse(raw) as T
	} catch (e) {
		console.warn('[ob-s3-bridge] JSON parse failed:', e)
		return fallback
	}
}

export function safeJsonStringify(value: unknown, fallback: string = '{}'): string {
	try {
		return JSON.stringify(value)
	} catch {
		return fallback
	}
}
