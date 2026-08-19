import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { npmPackFileList } from './helpers/npm-pack.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))
const root = dirname(testDir)
const readJson = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'))

const packageJson = await readJson('package.json')
const packageLock = await readJson('package-lock.json')
const manifest = await readJson('dsh-plugin.json')
const agentPluginManifests = await Promise.all([
  readJson('plugin.json'),
  readJson('.claude-plugin/plugin.json'),
  readJson('.codex-plugin/plugin.json'),
])
const readme = await readFile(join(root, 'README.md'), 'utf8')
const readmeZh = await readFile(join(root, 'README.zh.md'), 'utf8')

function markdownRows(source) {
  return source
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)))
}

assert.equal(packageJson.version, '1.0.0-rc.1')
assert.equal(packageLock.version, packageJson.version)
assert.equal(packageLock.packages[''].version, packageJson.version)
assert.equal(manifest.version, packageJson.version)
for (const agentManifest of agentPluginManifests) assert.equal(agentManifest.version, packageJson.version)
assert.match(packageJson.scripts.test, /node test\/release-docs-contract\.mjs/)

console.log('DR-200 RELEASE DOCS 1/1: public version sources agree on 1.0.0-rc.1')

assert.equal(packageJson.engines.node, '^22.19 || >=24')
for (const [label, source] of [['English README', readme], ['Chinese README', readmeZh]]) {
  const rows = markdownRows(source)
  const harnessWeb = rows.find((row) => row[0]?.includes('DeepSeek Harness Web'))
  const harnessHeadless = rows.find((row) => row[0]?.includes('DeepSeek Harness headless'))
  const tui = rows.find((row) => row[0]?.includes('dsh-TUI'))

  assert.ok(harnessWeb?.[0].includes('0.1.0-rc.7'), `${label} states the Harness Web baseline`)
  assert.ok(harnessWeb?.some((cell) => /Web (UI|client)|浏览器/.test(cell)), `${label} shows Web UI availability`)
  assert.ok(harnessHeadless?.[0].includes('0.1.0-rc.7'), `${label} states the Harness headless baseline`)
  assert.ok(harnessHeadless?.some((cell) => /not loaded|不加载/.test(cell)), `${label} says the Web client is not loaded headlessly`)
  assert.ok(tui?.[0].includes('0.8.1'), `${label} states the minimum dsh-TUI version`)
  assert.ok(tui?.[0].includes('v0.15'), `${label} identifies the v0.15 manifest contract`)
  assert.ok(tui?.some((cell) => /not loaded|不加载/.test(cell)), `${label} says dsh-TUI does not load the Web client`)
  assert.match(source, /Node(?:\.js)?[^\n]*22\.19[^\n]*(?:24|higher|以上)/i, `${label} exposes the Node engine requirement`)
}
assert.match(readme, /After DR-210 publishes[\s\S]*dsh-deepread@1\.0\.0-rc\.1/)
assert.match(readmeZh, /DR-210[^\n]*发布[\s\S]*dsh-deepread@1\.0\.0-rc\.1/)

console.log('DR-200 RELEASE DOCS 2/2: bilingual compatibility matrices expose host and Node baselines')

const upgradeGuide = await readFile(join(root, 'docs', 'upgrade-and-rollback.md'), 'utf8')
for (const identity of [
  "localStorage['dsh-deepread-history-v1']",
  "localStorage['dsh-deepread-calib']",
  '`deepread_url_cache` / version `1` / table `articles`',
  '`deepread_stats` / version `1` / table `stats` / key `default`',
]) {
  assert.ok(upgradeGuide.includes(identity), `upgrade guide preserves ${identity}`)
}
assert.match(upgradeGuide, /origin[\s\S]*protocol[\s\S]*domain[\s\S]*port/i)
assert.match(upgradeGuide, /DSH_HOME[\s\S]*different storage directory/i)
assert.match(upgradeGuide, /clearing (?:the )?site data[\s\S]*delete/i)
assert.ok(upgradeGuide.includes('dsh plugin --profile <profile> remove dsh-deepread'))
assert.ok(upgradeGuide.includes('dsh plugin --profile <profile> add dsh-deepread@0.5.4'))
assert.match(upgradeGuide, /after[\s\S]*prerelease[\s\S]*has been published[\s\S]*dsh-deepread@1\.0\.0-rc\.1/i)
assert.match(upgradeGuide, /no data conversion is required/i)
assert.match(upgradeGuide, /0\.5\.4[\s\S]*DeepSeek Harness Web[\s\S]*not[\s\S]*dsh-TUI v0\.15/i)
assert.match(readme, /\[Upgrade and rollback guide\]\(docs\/upgrade-and-rollback\.md\)/)
assert.match(readmeZh, /\[升级与回滚指南\]\(docs\/upgrade-and-rollback\.md\)/)

console.log('DR-200 RELEASE DOCS 3/3: upgrade retention conditions and 0.5.4 rollback are explicit')

const releaseNotesPath = 'docs/releases/1.0.0-rc.1.md'
const releaseNotes = await readFile(join(root, releaseNotesPath), 'utf8')
const communityUpdate = await readFile(join(root, 'docs/community-listing-update.md'), 'utf8')
const repositoryUrl = packageJson.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')
const npmVersionUrl = `https://www.npmjs.com/package/${packageJson.name}/v/${packageJson.version}`

assert.match(releaseNotes, /^# dsh-deepread 1\.0\.0-rc\.1/m)
assert.match(releaseNotes, /draft[\s\S]*not (?:yet )?published/i)
assert.match(releaseNotes, /Node\.js[\s\S]*\^22\.19 \|\| >=24/)
assert.match(releaseNotes, /lib\/types\/index\.js[\s\S]*dsh-plugin\.json[\s\S]*v0\.15/)
assert.match(releaseNotes, /Web[\s\S]*headless[\s\S]*dsh-TUI/i)
assert.match(releaseNotes, /no data (?:migration|conversion)/i)
assert.ok(releaseNotes.includes('../upgrade-and-rollback.md'))
assert.match(releaseNotes, /DR-210[\s\S]*(?:pending|not complete)/i)

assert.ok(communityUpdate.includes(repositoryUrl))
assert.ok(communityUpdate.includes(npmVersionUrl))
assert.ok(communityUpdate.includes(`${repositoryUrl}/blob/v${packageJson.version}/dsh-plugin.json`))
assert.match(communityUpdate, /minimum[\s\S]*dsh-TUI[\s\S]*0\.8\.1/i)
assert.match(communityUpdate, /Host-only[\s\S]*v0\.15/i)
assert.match(readme, /\[Draft release notes\]\(docs\/releases\/1\.0\.0-rc\.1\.md\)/)
assert.match(readmeZh, /\[预发布说明草稿\]\(docs\/releases\/1\.0\.0-rc\.1\.md\)/)

console.log('DR-200 RELEASE DOCS 4/4: release notes and community listing metadata are ready but unpublished')

const packedFiles = await npmPackFileList(root)
for (const requiredPath of [
  packageJson.main.replace(/^\.\//, ''),
  packageJson.types.replace(/^\.\//, ''),
  packageJson.exports['./client'].replace(/^\.\//, ''),
  packageJson.exports['./dsh-plugin.json'].replace(/^\.\//, ''),
  'docs/upgrade-and-rollback.md',
  releaseNotesPath,
  'docs/community-listing-update.md',
]) {
  assert.ok(packedFiles.includes(requiredPath), `npm tarball contains documented public file ${requiredPath}`)
}

for (const [path, source] of [['README.md', readme], ['README.zh.md', readmeZh]]) {
  assert.ok(!source.includes('index.mjs'), `${path} no longer documents the retired Host entry`)
  for (const requiredPath of ['src/index.ts', 'lib/types/index.js', 'dsh-plugin.json', 'lib/client.js']) {
    assert.ok(source.includes(requiredPath), `${path} documents ${requiredPath}`)
  }
  for (const requiredScript of ['build', 'typecheck:host', 'typecheck:browser', 'test']) {
    const command = requiredScript === 'test' ? 'npm test' : `npm run ${requiredScript}`
    assert.ok(source.includes(command), `${path} documents ${command}`)
    assert.ok(packageJson.scripts[requiredScript], `documented script ${requiredScript} exists`)
  }
  assert.ok(source.includes('npm pack --dry-run --json'), `${path} documents the release file-list check`)

  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0]
    if (target === '' || /^[a-z]+:/i.test(target)) continue
    await access(join(root, dirname(path), target))
  }
}

console.log('DR-200 RELEASE DOCS 5/5: README paths, commands, links, and tarball contents agree')

const agentsGuide = await readFile(join(root, 'AGENTS.md'), 'utf8')
const integrationGuide = await readFile(join(root, 'docs', 'deepseek-harness-integration.md'), 'utf8')

assert.match(agentsGuide, /package\.json[\s\S]*package-lock\.json[\s\S]*dsh-plugin\.json[\s\S]*version/i)
assert.match(agentsGuide, /release-docs-contract\.mjs/)
assert.match(agentsGuide, /docs\/upgrade-and-rollback\.md[\s\S]*docs\/releases\//)
assert.match(agentsGuide, /dsh-TUI[\s\S]*0\.8\.1[\s\S]*v0\.15/i)
assert.match(agentsGuide, /Web client[\s\S]*optional/i)

assert.match(integrationGuide, /Node\.js[\s\S]*\^22\.19 \|\| >=24/)
assert.match(integrationGuide, /dsh-TUI[\s\S]*0\.8\.1[\s\S]*v0\.15/i)
assert.match(integrationGuide, /webServer[\s\S]*(?:optional|可选)[\s\S]*headless/i)
assert.match(integrationGuide, /dsh-plugin\.json[\s\S]*Host-only[\s\S]*lib\/types\/index\.js/i)
assert.match(integrationGuide, /lib\/client\.js[\s\S]*(?:optional|可选)[\s\S]*Web/i)
assert.doesNotMatch(agentsGuide, /stock `headless` compatibility without first changing/i)
assert.doesNotMatch(integrationGuide, /当前列表包含 `webServer`|当前包只有在 Web-capable|`webServer` 是 Node 硬依赖/i)
assert.doesNotMatch(integrationGuide, /置信度标签存在字面颜色|暗黑模式工作应借机/i)

console.log('DR-200 RELEASE DOCS 6/6: maintainer guidance reflects optional Web and three-host packaging')
