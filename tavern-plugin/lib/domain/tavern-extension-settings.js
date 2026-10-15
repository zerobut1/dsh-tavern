import { isDeepStrictEqual } from 'node:util'

const settingsPath = 'tavern-extension-settings.json'
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

function settingsObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('插件设置必须是 JSON 对象')
  return JSON.parse(JSON.stringify(value))
}

function regexItems(settings) {
  return (Array.isArray(settings.regex) ? settings.regex : []).flatMap((script, index) =>
    script && typeof script === 'object' && !Array.isArray(script) ? [{
      index, name: String(script.scriptName || script.name || script.id || '正则 ' + (index + 1)),
      enabled: script.disabled !== true && script.enabled !== false, script
    }] : [])
}

/** Profile-owned plugin namespaces, separate from DSH settings and chat history. */
export function createTavernExtensionSettings(profileData) {
  const project = settingsObject
  const writable = settingsObject
  async function read() {
    // ProfileDataStore parses a fresh JSON object on each read; it is already detached.
    const value = await profileData.readJson(settingsPath) ?? {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('插件设置必须是 JSON 对象')
    return value
  }

  async function save(settings, expectedSettings) {
    const next = writable(settings)
    const base = writable(expectedSettings)
    const changed = [...new Set([...Object.keys(base), ...Object.keys(next)])].filter(key =>
      own(base, key) !== own(next, key) || !isDeepStrictEqual(base[key], next[key]))
    const saved = await profileData.updateJson(settingsPath, current => {
      const merged = writable(current ?? {})
      for (const key of changed) {
        const unchanged = own(merged, key) === own(base, key) && isDeepStrictEqual(merged[key], base[key])
        const alreadySaved = own(merged, key) === own(next, key) && isDeepStrictEqual(merged[key], next[key])
        if (!unchanged && !alreadySaved) throw new Error('插件设置已被其他窗口修改，请重新加载后重试: ' + key)
        if (own(next, key)) Object.defineProperty(merged, key, { value: next[key], enumerable: true, configurable: true, writable: true })
        else delete merged[key]
      }
      if(isDeepStrictEqual(merged,current ?? {}))return undefined
      return merged
    })
    return project(saved ?? {})
  }

  async function listRegex() { return regexItems(await read()) }

  async function updateRegex({ index, enabled, target, expected } = {}) {
    if (!Number.isInteger(index) || index < 0 || (enabled === undefined && target === undefined)
      || (enabled !== undefined && typeof enabled !== 'boolean')
      || (target !== undefined && !['display', 'prompt', 'both'].includes(target))) throw new Error('正则设置参数不合法')
    const saved = await profileData.updateJson(settingsPath, current => {
      const settings = writable(current ?? {})
      const script = Array.isArray(settings.regex) ? settings.regex[index] : undefined
      if (!script || typeof script !== 'object' || Array.isArray(script) || !isDeepStrictEqual(script, expected)) {
        throw new Error('全局正则已被其他窗口修改，请刷新后重试')
      }
      if (enabled !== undefined) {
        script.disabled = !enabled
        if (own(script, 'enabled')) script.enabled = enabled
      }
      if (target !== undefined) {
        script.markdownOnly = target !== 'prompt'
        script.promptOnly = target !== 'display'
      }
      return isDeepStrictEqual(settings, current) ? undefined : settings
    })
    return regexItems(saved ?? {})
  }

  return Object.freeze({ read, save, listRegex, updateRegex })
}
