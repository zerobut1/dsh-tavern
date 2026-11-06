// Native Session tests need the same host surface relaxation Tavern installs
// at runtime: assistant/message replacements may cite shadowed nodes. Without it,
// real Session.append rejects Tavern rollback/edit tombstones.
// The dedicated installer test verifies unpatched rejection itself, so skip there.
// 补丁不分 DSH 版本，这里也不按版本跳过：锚点漂移时直接抛错，而不是让
// 用真实 Session 的用例以难以定位的方式失败。
import { createRequire } from 'node:module'
import { basename, relative, isAbsolute } from 'node:path'
import { realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { prepareExpandedPatch } from '../../tavern-plugin/lib/domain/host-session-patch.js'

const APPLIED = Symbol.for('dsh-tavern.host-session-patch-preload.v1')

if (!globalThis[APPLIED] && !process.argv.some(arg => basename(arg) === 'host-session-patch.test.mjs')) {
  let runtimeRoot
  if (process.env.TAVERN_PROJECT_UNIT_TEST === '1') {
    runtimeRoot = fileURLToPath(new URL('../../', import.meta.url))
    const projectRequire = createRequire(new URL('../../package.json', import.meta.url))
    const { devDependencies } = projectRequire('./package.json')
    for (const name of Object.keys(devDependencies).filter(name => name.startsWith('@deepseek-ai/'))) {
      const resolved = relative(realpathSync(runtimeRoot), realpathSync(projectRequire.resolve(name)))
      if (resolved.startsWith('..') || isAbsolute(resolved)) throw new Error('单元测试依赖必须安装在项目内：' + name)
    }
  } else if (process.env.DSH_BOOT_MODULE) {
    const anchor = new URL('../../dsh-session/package.json', pathToFileURL(process.env.DSH_BOOT_MODULE))
    runtimeRoot = fileURLToPath(new URL('../../../', anchor))
  } else {
    const pluginRequire = createRequire(new URL('../../tavern-plugin/package.json', import.meta.url))
    const hostRequire = createRequire(pluginRequire.resolve('@deepseek-ai/dsh-tools'))
    const sessionPath = hostRequire.resolve('@deepseek-ai/dsh-session')
    runtimeRoot = sessionPath.split(/[/\\]node_modules[/\\]/)[0]
  }
  const patch = await prepareExpandedPatch(runtimeRoot)
  patch.selfTest()
  globalThis[APPLIED] = true
}
