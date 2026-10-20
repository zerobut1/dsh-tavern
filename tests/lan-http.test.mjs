import assert from 'node:assert/strict'
import test from 'node:test'
import { registerTavernHttpRoutes } from '../tavern-plugin/lib/http/routes.js'

function fixture() {
  let handler, internal, rejection, admissions = 0, dispatched = 0
  const origin = 'http://192.168.31.71:3084'
  const webServer = { host: '192.168.31.71', port: 3084, protocol: 'http:',
    register(spec) { if (spec.path === '/api/dsh-tavern') handler = spec.handler; return () => {} } }
  const connection = { requestRejection(req) { admissions++; assert.ok(req.headers); return rejection } }
  registerTavernHttpRoutes({
    ctx: { get: name => name === 'webServer' ? webServer : name === 'connection' ? connection : undefined, effect: fn => fn() },
    async dispatch(method, args) { dispatched++; return { ok: true, method, args } },
    str: String, performanceDiagnostics: { http() {} }, runtimeReadiness: Promise.resolve({ ok: true }),
    runtimeGeneration: 'fixture', exposeHandler: value => { internal = value },
    sessionResources: { async read(cap) { if (cap !== 'valid-capability') throw new Error('denied'); return '{}' } },
    tavernStaticResources: { async get() { return { mediaType: 'text/plain', body: Buffer.from('asset'), cache: 'hit' } } },
  })
  return { origin, setRejection(value) { rejection = value }, counts: () => ({ admissions, dispatched }),
    async request({ url = '/api/dsh-tavern/getCards', method = 'POST', requestOrigin = origin, host = '192.168.31.71:3084', inProcess = false } = {}) {
      const result = {}
      await (inProcess ? internal : handler)({ url, method, headers: { host, ...(requestOrigin === undefined ? {} : { origin: requestOrigin }) },
        async *[Symbol.asyncIterator]() { yield Buffer.from('{}') }
      }, { writeHead(status, headers) { Object.assign(result, { status, headers }) }, end(body) { result.body = body } })
      return result
    }
  }
}

test('局域网同源请求沿用 DSH 鉴权；未登录和不可信主机不能调用酒馆接口', async () => {
  const f = fixture()
  f.setRejection(401)
  assert.equal((await f.request()).status, 401)
  assert.equal((await f.request({ requestOrigin: '' })).status, 401)
  f.setRejection(403)
  assert.equal((await f.request({ host: 'other.invalid:3084' })).status, 403)
  assert.equal(f.counts().dispatched, 0)
  f.setRejection(undefined)
  assert.equal((await f.request()).status, 200)
  assert.equal(f.counts().dispatched, 1)
  assert.equal((await f.request({ requestOrigin: 'http://evil.invalid:3084' })).status, 403)
  assert.equal((await f.request({ requestOrigin: 'http://192.168.31.71:3081' })).status, 403)
  assert.equal(f.counts().dispatched, 1)
})

test('状态查询也受局域网鉴权；内部调用保留原有执行路径', async () => {
  const f = fixture()
  f.setRejection(401)
  assert.equal((await f.request({ url: '/api/dsh-tavern/runtime-generation', method: 'GET' })).status, 401)
  assert.equal((await f.request({ inProcess: true })).status, 200)
  assert.equal(f.counts().admissions, 1)
})

test('沙箱资源继续使用独立 capability；局域网同源静态缓存可读，跨站仍拒绝', async () => {
  const f = fixture()
  f.setRejection(401)
  assert.equal((await f.request({ url: '/api/dsh-tavern/session-resource?cap=valid-capability', method: 'GET', requestOrigin: 'null' })).status, 200)
  assert.equal((await f.request({ url: '/api/dsh-tavern/session-resource?cap=invalid', method: 'GET', requestOrigin: 'null' })).status, 403)
  assert.equal((await f.request({ url: '/api/dsh-tavern/static-assets?url=https://example.invalid/a', method: 'GET' })).status, 200)
  assert.equal((await f.request({ url: '/api/dsh-tavern/static-assets?url=https://example.invalid/a', method: 'GET', requestOrigin: 'http://evil.invalid' })).status, 403)
  assert.equal(f.counts().admissions, 0)
})
