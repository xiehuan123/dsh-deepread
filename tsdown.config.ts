import type { UserConfig } from 'tsdown'

const config: UserConfig = {
  name: 'dsh-deepread/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  external: ['react', '@deepseek-ai/dsh-client-runtime/client'],
  noExternal: (id: string) => id === 'react' || id === '@deepseek-ai/dsh-client-runtime/client' ? undefined : true,
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-deepread", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default config
