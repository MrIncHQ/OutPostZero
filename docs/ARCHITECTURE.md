# Outpost Zero Architecture

Outpost Zero is a portable Electron application. The Electron main process is the security and containment boundary; the React renderer receives a narrow, typed API through an isolated preload bridge.

## Current components

- `PortablePathService` discovers the `.outpost-zero-root` marker and owns every application-controlled writable path.
- The main process redirects Electron user data, session data, cache, logs, and temporary paths beneath the portable root before the app becomes ready.
- `SessionState` writes an atomic dirty/clean marker for shutdown recovery.
- `ProfileService` creates and preserves a drive-local Ed25519 identity and validated display name.
- `StorageService` scans declared portable categories without following symbolic links.
- `DatabaseService` owns the portable SQLite metadata database, versioned migrations, integrity checks, and rotating drive-local backups.
- `HardwareService` reports current host compute resources without persisting host data.
- `UpdateService` provides a provider-neutral update boundary; GitHub Releases is planned but deliberately unconfigured.
- The renderer has context isolation enabled, Node integration disabled, sandboxing enabled, and a restrictive content security policy.

Feature modules will be added only after the containment milestone is proven.
