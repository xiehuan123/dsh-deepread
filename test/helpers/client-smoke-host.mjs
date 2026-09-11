import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Exact validation boundary, not a claim that all newer prerelease APIs are compatible.
export const validatedHostVersion = '0.1.2-rc.1'

export function clientSmokeHost(label, requiredFiles) {
  const root = process.env.DSH_HARNESS_ROOT ?? '/Users/xiehuan/Desktop/project/deepseek-harness'
  const skip = (reason) => {
    console.log(`${label} SKIP: ${reason}; checkout: ${root}. Set DSH_HARNESS_ROOT to a built DeepSeek Harness ${validatedHostVersion} checkout. This does not validate real-host compatibility.`)
    return null
  }

  let version
  try {
    version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  } catch (error) {
    return skip(`cannot read host version from package.json (${error.code ?? error.name})`)
  }
  if (typeof version !== 'string' || version.length === 0) return skip('missing package.json version')
  if (version !== validatedHostVersion) {
    return skip(`host core ${version} is outside the validated version ${validatedHostVersion}`)
  }

  const missing = requiredFiles.filter((file) => !existsSync(join(root, file)))
  if (missing.length > 0) return skip(`missing required host files: ${missing.join(', ')}`)
  return root
}
