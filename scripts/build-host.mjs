import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const typesOutput = join(root, 'lib', 'types')

await rm(typesOutput, { recursive: true, force: true })
await execFileAsync(process.execPath, [
  join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  '--project',
  join(root, 'tsconfig.host.json'),
], { cwd: root })
