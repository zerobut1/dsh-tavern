import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Custom-branch units only: dependencies are in-memory doubles or temporary
// fixtures. No native DSH boot, browser, NapCat connection or model API.
const tests = [
  'background-session-retirement', 'background-agent-lifecycle', 'background-task-coordinator', 'header-shortcuts',
  'conversation-header', 'conversation-background-model', 'session-view-projection', 'card-preparation',
  'card-opening-previews', 'persistent-status-view',
  'worldbook-placement', 'worldbook-recall', 'compaction-request',
  'worldbook-library', 'helper-worldbook-api', 'helper-worldbook-creation', 'play-card-snapshot',
  'preset-editor', 'preset-library',
  'conversation-fork-point', 'conversation-fork-targets', 'conversation-fork',
  'regex-library', 'tavern-regex-order', 'history-tool-call',
  'conversation-background', 'foreground-tool-options',
  'mvu-background-settlement', 'background-command',
  'mobile-chat', 'qq-bridge', 'conversation-messenger', 'onebot-client',
  'launcher-network', 'lan-http', 'browser-request-id'
]
const root = fileURLToPath(new URL('..', import.meta.url))
const result = spawnSync(process.execPath, ['--test', ...tests.map(name => path.join(root, 'tests', name + '.test.mjs'))], {
  cwd: root, stdio: 'inherit'
})
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
