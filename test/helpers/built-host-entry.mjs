import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function loadBuiltHostEntry(root, packageDir) {
  const typesDir = join(packageDir, 'lib', 'types')
  const legacyDir = join(packageDir, 'lib', 'legacy')
  await mkdir(typesDir, { recursive: true })
  await mkdir(legacyDir, { recursive: true })
  await copyFile(join(root, 'lib', 'types', 'index.js'), join(typesDir, 'index.js'))
  await copyFile(join(root, 'lib', 'legacy', 'index.mjs'), join(legacyDir, 'index.mjs'))
  return import(pathToFileURL(join(typesDir, 'index.js')).href)
}
