import path from 'path'

/**
 * The project's `.seed` directory on Node: `<process.cwd()>/.seed`. Apps whose working directory
 * isn't writable (a packaged Electron app's is often `/`) chdir before init or pass an absolute
 * filesDir.
 */
export function getDotSeedDir(): string {
  return path.join(process.cwd(), '.seed')
}
