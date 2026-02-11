const path = require('node:path')

function toAbsolutePath(filename) {
  return path.isAbsolute(filename) ? filename : path.resolve(process.cwd(), filename)
}

module.exports = {
  'packages/sdk/**/*.{ts,tsx}': (filenames) => {
    // Filter out dist, generated files, and example bot directories.
    const filtered = filenames.filter((filename) => {
      const normalized = filename.replace(/\\/g, '/')
      return (
        !normalized.includes('/dist/') &&
        !normalized.includes('src/generated.ts') &&
        !normalized.includes('/examples/liquidation-bot/') &&
        !normalized.includes('/examples/oracle-poker/')
      )
    })

    if (filtered.length === 0) return []

    // Convert paths from repo root/absolute to package-relative paths.
    const packageRelativePaths = filtered.map((filename) =>
      path.relative(__dirname, toAbsolutePath(filename)),
    )

    return [
      `pnpm --filter @panoptic-eng/sdk exec eslint --fix --max-warnings=0 --ignore-pattern 'dist/**' --ignore-pattern 'graphql/**' --ignore-pattern 'src/graphql/**' ${packageRelativePaths.join(' ')}`,
    ]
  },
}
