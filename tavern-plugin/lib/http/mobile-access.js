import { createRequire } from 'node:module'
import { networkInterfaces } from 'node:os'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)

// A Tavern-owned listener: no separate process, home settings or startup script.
export async function startMobileAccess(ctx) {
  const webServer = ctx.get('webServer')
  if (!webServer?.port || process.env.DSH_TAVERN_MOBILE === '0') return () => {}
  const addresses = Object.values(networkInterfaces()).flat().filter(address =>
    address.family === 'IPv4' && !address.internal &&
    /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address.address))
  const host = addresses[0]?.address
  if (!host) return () => {}
  const port = Number(process.env.DSH_TAVERN_MOBILE_PORT || 3082)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('无效的手机访问端口')
  const root = new URL('./', pathToFileURL(require.resolve('dsh-pocket/package.json')))
  const { createPocketProxy, DEFAULT_INJECT, classifyHost } = await import(new URL('lib/proxy.mjs', root))
  const connection = ctx.get('connection')
  const privatePin = randomBytes(32).toString('hex')
  const upstreamHost = webServer.host || '127.0.0.1'
  const proxy = await createPocketProxy({
    host, port, upstream: { host: upstreamHost, port: webServer.port },
    // Reject public TCP peers; only this computer and private-network peers use the listener.
    auth: { sessionKey: privatePin, getToken: () => privatePin, isProtected: value => classifyHost(value) === 'public' },
    launchToken: () => {
      const url = connection?.authenticatedUrl?.(`http://${upstreamHost}:${webServer.port}/`)
      return url ? new URL(url).searchParams.get('token') || '' : ''
    },
    injectHtml: DEFAULT_INJECT + (existsSync(new URL('../mobile-assets/index.html', import.meta.url))
      ? '<script>if(location.pathname==="/"&&!new URLSearchParams(location.search).has("tavern-mobile-status"))location.replace("/mobile");</script>' : ''),
  })
  console.log(`DSH Tavern 手机访问：http://${host}:${proxy.port}/`)
  return () => proxy.close()
}
