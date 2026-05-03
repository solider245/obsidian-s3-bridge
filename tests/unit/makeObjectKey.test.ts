import { describe, it, expect } from 'vitest'
import { makeObjectKey } from '../../src/core/objectKey'

describe('makeObjectKey', () => {
	it('导出存在', () => {
		expect(typeof makeObjectKey).toBe('function')
	})
})
