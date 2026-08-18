import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function npmPackFileList(root) {
  const cache = await mkdtemp(join(tmpdir(), 'dsh-deepread-npm-cache-'))
  try {
    const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json', '--cache', cache], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    })
    const match = /\[\s*\{\s*"id"/.exec(stdout)
    if (match === null) throw new Error(`npm pack did not return JSON: ${stdout}`)
    const pack = JSON.parse(stdout.slice(match.index))
    return pack[0].files.map((file) => file.path).sort()
  } finally {
    await rm(cache, { recursive: true, force: true })
  }
}
