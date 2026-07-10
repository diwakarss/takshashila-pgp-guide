// electron-builder afterPack hook: bundle the right Node runtime into the
// app's resources (resources/node/node[.exe]). The embedder child process
// needs a real Node — students don't have one installed — and onnxruntime
// SIGTRAPs under Electron's own Node, so Electron itself can't host it.
const { copyFileSync, mkdirSync, chmodSync } = require('node:fs')
const path = require('node:path')

const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' }

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName // 'darwin' | 'win32' | 'linux'
  const arch = ARCH[context.arch] ?? 'x64'
  const src = path.join(
    __dirname,
    '..',
    'build',
    'node',
    `${platform === 'win32' ? 'win' : platform}-${arch}`,
    platform === 'win32' ? 'node.exe' : 'node'
  )
  const resDir =
    platform === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources')
  const destDir = path.join(resDir, 'node')
  mkdirSync(destDir, { recursive: true })
  const dest = path.join(destDir, platform === 'win32' ? 'node.exe' : 'node')
  copyFileSync(src, dest)
  if (platform !== 'win32') chmodSync(dest, 0o755)
  console.log(`  • bundled node runtime → ${dest}`)
}
