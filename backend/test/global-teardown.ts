import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

/** Stops the shared container once every suite has finished. */
module.exports = async function globalTeardown(): Promise<void> {
  const container = (globalThis as Record<string, unknown>).__PG_CONTAINER__ as
    | StartedPostgreSqlContainer
    | undefined

  await container?.stop()
}