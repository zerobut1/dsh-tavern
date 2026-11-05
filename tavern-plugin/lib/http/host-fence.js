// Opaque card frames are cross-site even for local resources; only Host is shared here.
// Like Connection, accept loopback, the listener's own bind IP and configured
// trustedHosts (exact host:port, or a port-less host on any port). The bind IP
// comes from the webServer service, never from request headers. This is the
// DNS-rebinding fence for public assets, never authentication.
export function isTrustedHostRequest(req, trustedHosts = [], bindHost) {
  const url = parseFenceAuthority(req.headers.host)
  if (url === undefined) return false
  if (url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname)) return true
  if (typeof bindHost === 'string') {
    // An IPv6 zone selects the local interface; it is not part of the address.
    const address = bindHost.split('%')[0]
    const bound = parseFenceAuthority(address.includes(':') ? `[${address}]` : address)
    if (bound?.hostname === url.hostname) return true
  }
  return Array.isArray(trustedHosts) && trustedHosts.some(entry => {
    const trusted = parseFenceAuthority(entry)
    if (trusted === undefined || trusted.hostname !== url.hostname) return false
    return !/:\d+$/.test(entry) || trusted.port === url.port
  })
}

function parseFenceAuthority(value) {
  if (typeof value !== 'string') return undefined
  let url
  try { url = new URL('http://' + value) } catch { return undefined }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined
  return url
}
