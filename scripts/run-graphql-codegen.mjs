#!/usr/bin/env node

import { spawn } from 'node:child_process'

const MAX_ATTEMPTS = Number.parseInt(process.env.GRAPHQL_CODEGEN_MAX_ATTEMPTS ?? '4', 10)
const BASE_DELAY_MS = Number.parseInt(process.env.GRAPHQL_CODEGEN_RETRY_DELAY_MS ?? '60000', 10)

const CODEGEN_ARGS = ['graphql-codegen-esm', '--config', './codegen.ts']

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableFailure(output) {
  const lowered = output.toLowerCase()
  return (
    lowered.includes('error 502') ||
    lowered.includes('bad gateway') ||
    lowered.includes('origin_bad_gateway') ||
    lowered.includes('cloudflare') ||
    lowered.includes('retryable') ||
    lowered.includes('unexpected empty "data" and "errors" fields')
  )
}

async function runOnce() {
  return new Promise((resolve) => {
    const child = spawn('pnpm', CODEGEN_ARGS, { stdio: ['inherit', 'pipe', 'pipe'] })
    let combinedOutput = ''

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      combinedOutput += text
      process.stdout.write(text)
    })

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      combinedOutput += text
      process.stderr.write(text)
    })

    child.on('close', (code) => {
      resolve({ code: code ?? 1, output: combinedOutput })
    })
  })
}

async function main() {
  const attempts = Number.isFinite(MAX_ATTEMPTS) && MAX_ATTEMPTS > 0 ? MAX_ATTEMPTS : 4
  const baseDelay = Number.isFinite(BASE_DELAY_MS) && BASE_DELAY_MS > 0 ? BASE_DELAY_MS : 60000

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await runOnce()
    if (result.code === 0) return

    const shouldRetry = attempt < attempts && isRetryableFailure(result.output)
    if (!shouldRetry) {
      process.exit(result.code)
    }

    const delayMs = baseDelay * attempt
    process.stderr.write(
      `[codegen] Attempt ${attempt}/${attempts} failed with retryable schema error. Retrying in ${Math.round(
        delayMs / 1000,
      )}s...\n`,
    )
    await sleep(delayMs)
  }
}

await main()
