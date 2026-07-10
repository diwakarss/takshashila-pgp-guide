#!/usr/bin/env node
// Vendor sharp's platform binaries for CROSS-PLATFORM packaging.
//
// npm keeps only the current platform's @img/sharp-* optional packages and
// prunes the rest on every install — so a Windows build packed from a Mac
// ships without the win32-x64 binary and the embedder dies on first import
// ("Could not load the sharp module using the win32-x64 runtime", seen live
// on the first Windows install). This script downloads the needed platform
// packages straight from the npm registry into node_modules/@img/, where the
// package manager can't prune what it didn't install. Run before build:win.

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IMG = path.join(ROOT, 'node_modules', '@img')

// Keep in sync with node_modules/sharp/package.json's optionalDependencies.
const SHARP_VERSION = '0.34.5'
const WANTED = ['sharp-win32-x64'] // add darwin-x64 etc. here if targets grow

for (const name of WANTED) {
  const dest = path.join(IMG, name)
  if (existsSync(dest)) {
    console.log(`✓ @img/${name} already present`)
    continue
  }
  const tmp = path.join(ROOT, `.sharp-tmp-${name}`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  console.log(`↓ @img/${name}@${SHARP_VERSION}`)
  const tarball = execSync(`npm pack @img/${name}@${SHARP_VERSION} --pack-destination "${tmp}"`, {
    cwd: tmp,
    encoding: 'utf8'
  })
    .trim()
    .split('\n')
    .pop()
  execSync(`tar -xzf "${path.join(tmp, tarball)}" -C "${tmp}"`)
  mkdirSync(IMG, { recursive: true })
  renameSync(path.join(tmp, 'package'), dest)
  rmSync(tmp, { recursive: true, force: true })
  console.log(`✓ vendored → node_modules/@img/${name}`)
}
