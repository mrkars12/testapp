import { execFileSync } from 'child_process'
import { join } from 'path'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

/**
 * Starts one Postgres container for the entire run.
 *
 * Previously each spec started its own container in beforeAll and shut
 * it down in afterAll. That multiplied container startup and `db push`
 * by the number of suites, and any spec that outlived its container left
 * later suites holding a dead client. Doing it once here removes both.
 *
 * The URL is published on process.env so every spec reads the same
 * database. jest-integration runs with --runInBand, so there is exactly
 * one worker and no risk of suites racing each other.
 */
module.exports = async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('payments_test')
    .withUsername('test')
    .withPassword('test')
    // Durability settings only matter if the data must survive a crash.
    // This database is thrown away at the end of the run, and leaving
    // fsync on made TRUNCATE ... CASCADE take over thirty seconds per
    // test on a slow container — the whole suite was waiting on disk.
    .withCommand([
      'postgres',
      '-c', 'fsync=off',
      '-c', 'synchronous_commit=off',
      '-c', 'full_page_writes=off',
      '-c', 'autovacuum=off',
    ])
    .start()

  const raw = container.getConnectionUri()

  // Postgres waits for a lock forever by default, so a blocked TRUNCATE
  // hangs the suite with no output. These turn that into a fast, named
  // error. Set through the URL because Prisma pools connections and a
  // SET would only affect whichever connection ran it.
  const options = [
    '-c lock_timeout=5000',
    '-c statement_timeout=30000',
    '-c idle_in_transaction_session_timeout=15000',
  ].join(' ')

  const url = `${raw}${raw.includes('?') ? '&' : '?'}options=${encodeURIComponent(options)}`

  pushSchema(url)

  process.env.TEST_DATABASE_URL = url
  ;(globalThis as Record<string, unknown>).__PG_CONTAINER__ = container
}

/**
 * Applies the schema to the fresh container.
 *
 * The Prisma CLI is invoked directly rather than through npx: npx
 * prompts on stdin when it has to resolve a package, and with stdio
 * piped that prompt is invisible and waits forever. stdin is closed and
 * a timeout is set, because execFileSync blocks the event loop and Jest
 * cannot time it out from the outside.
 */
function pushSchema(url: string): void {
  const binary = join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
  )

  try {
    execFileSync(binary, ['db', 'push', '--skip-generate', '--accept-data-loss'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      windowsHide: true,
    })
  } catch (error) {
    const detail = error as {
      status?: number
      signal?: string
      stdout?: Buffer
      stderr?: Buffer
      message?: string
    }

    throw new Error(
      [
        'prisma db push failed while preparing the test database.',
        `binary: ${binary}`,
        detail.signal ? `signal: ${detail.signal}` : `exit code: ${detail.status}`,
        detail.stdout?.toString().trim(),
        detail.stderr?.toString().trim(),
        detail.message,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
}