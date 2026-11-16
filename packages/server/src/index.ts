// Package entry for other workspace packages (@fm/sync-tests). The composition root is src/main.ts.
export { createServerApp, type Connection, type ServerApp, type ServerAppDeps, type Session } from "./app/server-app";
export { createInMemoryRepository, type InMemoryRepository } from "./app/testing";
export { domainValidator } from "./adapters/domain-validator";
export type { ChangesetValidator, ProjectRepository, ProjectState } from "./app/ports";
