import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Custom-branch units only: dependencies are in-memory doubles or temporary
// fixtures. No native DSH boot, browser, NapCat connection or model API.
const tests = [
  'background-session-retirement', 'background-agent-lifecycle', 'background-task-coordinator', 'header-shortcuts',
  'card-opening-previews', 'persistent-status-view',
  'worldbook-placement', 'worldbook-recall', 'compaction-request',
  'conversation-fork-point', 'conversation-fork-targets', 'conversation-fork',
  'regex-library', 'tavern-regex-order', 'history-tool-call',
  'conversation-background', 'foreground-tool-options',
  'mvu-background-settlement',
  'text-colors', 'scene-image-prompt', 'scene-image-prompts', 'scene-image-opinion',
  'mobile-chat', 'qq-bridge', 'conversation-messenger', 'onebot-client',
  'launcher-network', 'lan-http', 'browser-request-id'
]
const root = fileURLToPath(new URL('..', import.meta.url))
const result = spawnSync(process.execPath, ['--test', ...tests.map(name => path.join(root, 'tests', name + '.test.mjs'))], {
  cwd: root, stdio: 'inherit'
})
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
