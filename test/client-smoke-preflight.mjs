import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const fixture = mkdtempSync(join(tmpdir(), 'deepread-smoke-host-'))
const system = 'packages/client/modules/lib/types/client/system.js'
const scripts = ['client-lifecycle', 'client-drag', 'client-platform']

function run(script) {
  return spawnSync(process.execPath, [join(root, 'test', `${script}.mjs`)], {
    env: { ...process.env, DSH_HARNESS_ROOT: fixture }, encoding: 'utf8', timeout: 10000,
  })
}

function expectSkip(reason) {
  for (const script of scripts) {
    const result = run(script)
    assert.equal(result.status, 0, `${script}: ${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /SKIP:/, `${script} reports a skip explicitly`)
    assert.match(result.stdout, reason)
    assert.ok(result.stdout.includes(fixture), `${script} names the inspected checkout`)
    assert.doesNotMatch(result.stderr, /TypeError|HOST_MODULE_IMPORTED/)
    if (script === 'client-platform') {
      assert.match(result.stdout, /no removed runtime facade or undeclared module requests/,
        'local bundle assertions still run when the real-host portion is skipped')
    }
  }
}

try {
  mkdirSync(dirname(join(fixture, system)), { recursive: true })
  // A built newer host would throw on options.manifest.modules. It must never be imported.
  writeFileSync(join(fixture, system), 'throw new Error("HOST_MODULE_IMPORTED");\n')
  for (const version of ['0.1.3-alpha.1', '0.1.2-rc.2', '0.1.0-rc.7']) {
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ type: 'module', version }))
    expectSkip(new RegExp(`host core ${version.replaceAll('.', '\\.')}.*outside.*0\\.1\\.2-rc\\.1`))
  }

  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ type: 'module' }))
  expectSkip(/missing.*version/)
  writeFileSync(join(fixture, 'package.json'), '{')
  expectSkip(/cannot read host version/)
  rmSync(join(fixture, 'package.json'))
  expectSkip(/cannot read host version/)

  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ type: 'module', version: '0.1.2-rc.1' }))
  rmSync(join(fixture, system))
  expectSkip(/missing required host (?:build )?files:.*system\.js/)
  mkdirSync(dirname(join(fixture, system)), { recursive: true })
  writeFileSync(join(fixture, system), 'throw new Error("HOST_MODULE_IMPORTED");\n')
  const drag = run('client-drag')
  assert.equal(drag.status, 0)
  assert.match(drag.stdout, /missing required host (?:build )?files:.*ui-slots.*web-react/)

  // A supported host must reach its loader, and actual import errors must not become skips.
  const lifecycle = run('client-lifecycle')
  assert.notEqual(lifecycle.status, 0)
  assert.match(lifecycle.stderr, /HOST_MODULE_IMPORTED/)
  assert.doesNotMatch(lifecycle.stdout, /SKIP:/)
  console.log('CLIENT SMOKE PREFLIGHT: all real-loader entry points reject unsupported hosts before import, explain missing files, and retain local assertions')
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
