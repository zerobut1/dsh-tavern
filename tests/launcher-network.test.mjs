import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import { assertLocalBindHost, configureServiceNetwork, readNetworkConfig, resolveServiceBindHost, selectLanAddress, serviceBindHost } from '../bin/service-network.mjs'
import { isServiceReady, resolveServiceWebUrl } from '../bin/service-lifecycle.mjs'

const interfaces = { lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
  en0: [{ family: 'IPv4', internal: false, address: '192.168.31.71' }],
  utun7: [{ family: 'IPv4', internal: false, address: '198.18.0.1' }] }

test('局域网配置默认只监听本机，明确选择地址并保存在用户数据目录', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tavern-network-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'tavern-network.json'), output = []
  const options = { file, interfaces, log: line => output.push(line) }
  assert.equal(resolveServiceBindHost({ file, env: {} }), '127.0.0.1')
  assert.equal(configureServiceNetwork([], options), '192.168.31.71')
  assert.deepEqual(readNetworkConfig(file), { bindHost: '192.168.31.71' })
  assert.equal(resolveServiceBindHost({ file, env: {} }), '192.168.31.71')
  assert.equal(resolveServiceBindHost({ file, env: { DSH_TAVERN_LAN: '0' } }), '127.0.0.1')
  assert.equal(resolveServiceBindHost({ file, env: { DSH_TAVERN_BIND: '127.0.0.1', DSH_TAVERN_LAN: '1' } }), '127.0.0.1')
  assert.equal(resolveServiceBindHost({ env: { DSH_TAVERN_LAN: '1' }, interfaces }), '192.168.31.71')
  assert.equal(configureServiceNetwork(['--status'], options), '192.168.31.71')
  assert.match(output.join('\n'), /尚未启动或重启服务/)
  writeFileSync(file, 'invalid')
  assert.throws(() => readNetworkConfig(file), /JSON/)
  configureServiceNetwork(['--off'], options)
  assert.equal(resolveServiceBindHost({ file, env: {} }), '127.0.0.1')
})

test('拒绝通配地址、主机名、非本机地址；多网卡必须明确选择', () => {
  for (const value of ['0.0.0.0', '::', 'localhost', '', '192.168.31.71/path', '192.168.31.71:3081']) {
    assert.throws(() => serviceBindHost(value), /IPv4/)
  }
  assert.equal(assertLocalBindHost('192.168.31.71', interfaces), '192.168.31.71')
  assert.throws(() => assertLocalBindHost('192.168.31.72', interfaces), /已不在本机网卡/)
  assert.throws(() => selectLanAddress({}), /没有找到/)
  const multiple = { ...interfaces, en1: [{ family: 'IPv4', internal: false, address: '10.0.0.2' }] }
  assert.throws(() => selectLanAddress(multiple), /多个.*en0.*en1/)
})

test('局域网就绪探测和链接验证使用实际地址与端口，保留 token 并拒绝其他来源', async () => {
  const host = '192.168.31.71', port = 3084, url = `http://${host}:${port}/?token=test-lan-token`
  await isServiceReady(port, async target => { assert.equal(target, `http://${host}:${port}/`); return { status: 401 } }, 'cli', host)
  for (const candidate of [url, 'http://127.0.0.1:3084/?token=wrong', 'http://192.168.31.72:3084/?token=wrong', 'http://192.168.31.71:3081/?token=wrong', 'http://user@192.168.31.71:3084/?token=wrong']) {
    const calls = []
    const result = await resolveServiceWebUrl({ port, record: { host }, log: `dsh web: ${candidate}\n`, request: async (target, options) => {
      calls.push(target); assert.equal(options.redirect, 'manual')
      return { status: target === url ? 303 : 401 }
    } })
    assert.equal(result, candidate === url ? url : '')
    assert.ok(calls.every(target => new URL(target).origin === `http://${host}:${port}`))
  }
})

test('已拥有的进程始终按 PID 记录的地址检测，旧记录继续使用回环地址', async () => {
  const source = readFileSync(new URL('../bin/service-lifecycle.mjs', import.meta.url), 'utf8')
  const code = source.slice(source.indexOf('async function serviceState('), source.indexOf('export function legacyServiceOwnedHere'))
  for (const recordedHost of ['192.168.31.71', undefined]) {
    const probes = [], expectedHost = recordedHost ?? '127.0.0.1'
    const context = vm.createContext({
      readPidRecord: () => ({ pid: 123, port: 3084, host: recordedHost }), inspectRecordedProcess: () => 'owned',
      serviceBindHost, CLI_HOST: '127.0.0.1', CLI_PORT: 3081, RUNTIME_HOST: 'cli', fetch() {},
      configuredServiceHost() { assert.fail('配置变化或损坏不能影响现有进程的检测') },
      async isPortOpen(port, host) { probes.push(['tcp', port, host]); return true },
      async isServiceReady(port, _request, _runtime, host) { probes.push(['http', port, host]); return true },
    })
    vm.runInContext(code, context)
    const state = await context.serviceState()
    assert.equal(state.host, expectedHost)
    assert.deepEqual(probes, [['tcp', 3084, expectedHost], ['http', 3084, expectedHost]])
  }
})
