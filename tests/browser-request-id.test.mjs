import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test from 'node:test'
import { browserRequestId } from '../tavern-plugin/lib/domain/browser-request-id.js'

test('LAN HTTP 缺少 randomUUID 时仍生成符合手机接口要求的 UUID v4', () => {
  const provider = { getRandomValues: bytes => webcrypto.getRandomValues(bytes) }
  const ids = Array.from({ length: 50 }, () => browserRequestId(provider))
  for (const id of ids) assert.match(id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
  assert.equal(new Set(ids).size, ids.length)
})

test('安全上下文继续使用浏览器提供的 randomUUID', () => {
  assert.equal(browserRequestId({ randomUUID: () => 'native-request-id' }), 'native-request-id')
})

