import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('..', import.meta.url))

async function runProbe(t, body) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tavern 测试入口 '))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'probe with spaces.test.mjs')
  await writeFile(file, "import test from 'node:test'; import assert from 'node:assert/strict';\n" + body)
  // A nested CLI must start a new runner, rather than inherit Node's worker mode.
  const env = { ...process.env, NO_COLOR: '1' }
  delete env.NODE_TEST_CONTEXT
  return spawnSync(process.execPath, ['bin/test-tavern.mjs', file], {
    cwd: root, encoding: 'utf8', timeout: 30000,
    env
  })
}

test('真实测试入口加载宿主补丁，并支持带空格和中文的测试路径', { timeout: 35000 }, async t => {
  const result = await runProbe(t, `test('probe preload', () => {
    assert.equal(globalThis[Symbol.for('dsh-tavern.host-session-patch-preload.v1')], true);
    assert.ok(process.env.DSH_BOOT_MODULE);
  });`)
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /probe preload/)
})

test('真实测试入口保留失败退出码，不把未运行或失败的测试当成成功', { timeout: 35000 }, async t => {
  const result = await runProbe(t, `test('probe failure', () => {
    assert.equal(globalThis[Symbol.for('dsh-tavern.host-session-patch-preload.v1')], true);
    assert.fail('expected-custom-runner-failure');
  });`)
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1)
  assert.match(result.stdout + result.stderr, /expected-custom-runner-failure/)
})
