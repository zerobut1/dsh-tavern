import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Fixed synchronization gate. Run EVERY case in EVERY listed file after EVERY
// upstream sync, regardless of its diff. Never select tests by the current conflict.
// Keep the upstream suites intact, including new cases added inside these files.
const upstreamUnits = [
  'background-task-coordinator', 'background-tasks', 'mvu-background-settlement',
  'header-shortcuts', 'conversation-header', 'conversation-background-model', 'session-view-projection',
  'card-preparation', 'card-opening-previews', 'opening-slash',
  'native-surface-repair', 'story-reconciliation', 'transcript-row-plan',
  'conversation-fork-point', 'conversation-fork-targets', 'conversation-fork',
  'compaction-request', 'worldbook-library', 'helper-worldbook-api', 'helper-api-completeness', 'play-card-snapshot',
  'preset-library', 'regex-manager', 'tavern-regex-order', 'reply-presentation', 'history-tool-call',
  'manual-panel-docking', 'foreground-orchestration-strategies', 'tavern-http-origin',
]
// Minimal custom units: in-memory ports or self-owned temporary fixtures only.
// No DSH installation/user data, ffmpeg, listening ports, browser or model API.
const customUnits = [
  'background-session-retirement', 'background-agent-lifecycle', 'background-command', 'custom-rpc',
  'composer-enter', 'conversation-background', 'foreground-tool-options', 'story-submission-guard',
  'persistent-status-view', 'worldbook-placement', 'helper-worldbook-creation', 'preset-editor', 'posture-editor',
  'inline-card-prose', 'script-display-layer', 'qq-bridge', 'conversation-messenger', 'onebot-client',
]
if (process.argv.length > 2) {
  console.error('同步单元测试使用固定清单，不接受临时文件或用例筛选。')
  process.exit(1)
}
const root = fileURLToPath(new URL('..', import.meta.url))
const tests = [...upstreamUnits, ...customUnits]
// Do not inherit a shell's DSH host selection, module preload or package lookup.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/^(DSH_|TAVERN_)/.test(name) && !['NODE_OPTIONS', 'NODE_PATH'].includes(name)))
console.log(`固定单元检查：${upstreamUnits.length} 份上游兼容测试 + ${customUnits.length} 份自定义最小测试（含共享文件中的自定义用例）。`)
const result = spawnSync(process.execPath, ['--test', ...tests.map(name => path.join(root, 'tests', name + '.test.mjs'))], {
  cwd: root, env, stdio: 'inherit', windowsHide: true
})
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
