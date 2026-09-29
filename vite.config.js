import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'

/** The commit being built, baked into the bundle for run reports. */
function commitHash() {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  base: '',
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash()),
  },
})
