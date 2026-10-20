import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { networkInterfaces } from 'node:os'
import path from 'node:path'

export function serviceBindHost(value = '127.0.0.1') {
  if (typeof value !== 'string' || isIP(value) !== 4 || value === '0.0.0.0') {
    throw new Error('监听地址必须是具体的本机 IPv4 地址，不能使用 0.0.0.0 或主机名。')
  }
  return value
}

export function localIpv4Addresses(interfaces = networkInterfaces()) {
  return Object.entries(interfaces).flatMap(([name, rows]) => (rows || [])
    .filter(row => row.family === 'IPv4' && !row.internal)
    .map(row => ({ name, address: row.address })))
}

export function assertLocalBindHost(host, interfaces = networkInterfaces()) {
  serviceBindHost(host)
  if (!host.startsWith('127.') && !localIpv4Addresses(interfaces).some(row => row.address === host)) {
    throw new Error(`监听地址 ${host} 已不在本机网卡上；请运行 pnpm run lan:tavern 重新选择当前局域网地址。`)
  }
  return host
}

export function selectLanAddress(interfaces = networkInterfaces()) {
  const candidates = localIpv4Addresses(interfaces).filter(row =>
    /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(row.address))
  const addresses = [...new Set(candidates.map(row => row.address))]
  if (addresses.length !== 1) {
    throw new Error(addresses.length === 0 ? '没有找到局域网 IPv4 地址，请先连接局域网。'
      : `找到多个局域网地址：${candidates.map(row => `${row.name}: ${row.address}`).join('、')}；请运行 pnpm run lan:tavern <IP> 明确选择。`)
  }
  return addresses[0]
}

export function readNetworkConfig(file) {
  let source
  try { source = readFileSync(file, 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
  let config
  try { config = JSON.parse(source) } catch { throw new Error(`网络配置不是有效 JSON：${file}`) }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`网络配置必须是对象：${file}`)
  return config
}

export function resolveServiceBindHost({ file, env = process.env, interfaces } = {}) {
  if (env.DSH_TAVERN_BIND !== undefined) return serviceBindHost(env.DSH_TAVERN_BIND)
  if (env.DSH_TAVERN_LAN === '1') return selectLanAddress(interfaces)
  if (env.DSH_TAVERN_LAN === '0') return '127.0.0.1'
  return serviceBindHost((file ? readNetworkConfig(file).bindHost : undefined) ?? '127.0.0.1')
}

// This command only saves configuration; it never starts, stops or probes a service.
export function configureServiceNetwork(args, { file, interfaces = networkInterfaces(), log = console.log }) {
  if (args.length > 1) throw new Error('用法：pnpm run lan:tavern [IPv4地址|--off|--status]')
  const option = args[0]
  if (option === '--status') {
    const host = serviceBindHost(readNetworkConfig(file).bindHost ?? '127.0.0.1')
    log(`已保存的监听地址：${host}`)
    log(`本机网卡：${localIpv4Addresses(interfaces).map(row => `${row.name}: ${row.address}`).join('、')}`)
    log(`配置文件：${file}`)
    return host
  }
  const host = option === '--off' ? '127.0.0.1' : assertLocalBindHost(option ?? selectLanAddress(interfaces), interfaces)
  // --off also repairs a malformed configuration without reading it first.
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ bindHost: host }, null, 2) + '\n', { mode: 0o600 })
  log(`已保存监听地址：${host}`)
  log(`配置文件：${file}`)
  log('配置将在下次启动生效；尚未启动或重启服务。运行 pnpm run start:tavern；服务已运行时请用 pnpm run restart:tavern。')
  return host
}
