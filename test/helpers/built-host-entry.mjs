import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function loadBuiltHostEntry(root, packageDir) {
  const typesDir = join(packageDir, 'lib', 'types')
  await mkdir(typesDir, { recursive: true })
  await cp(join(root, 'lib', 'types'), typesDir, { recursive: true })
  return import(pathToFileURL(join(typesDir, 'index.js')).href)
}
