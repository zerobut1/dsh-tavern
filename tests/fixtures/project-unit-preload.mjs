import { realpathSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// A developer's plugin may link to an installed host. Units must resolve their
// DSH imports from the project's locked test dependencies instead, or fail.
const project = new URL('../../package.json', import.meta.url)
const root = realpathSync(fileURLToPath(new URL('./', project)))
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@deepseek-ai/')) return nextResolve(specifier, context)
    const result = nextResolve(specifier, { ...context, parentURL: project.href })
    const resolved = relative(root, realpathSync(fileURLToPath(result.url)))
    if (resolved.startsWith('..') || isAbsolute(resolved)) throw new Error('单元测试依赖必须安装在项目内：' + specifier)
    return result
  }
})
