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
- `UpdateService` verifies the pinned Ed25519 signature on GitHub manifests, rejects non-runtime paths, downloads changed files into portable staging, verifies SHA-256 hashes, and launches the external swap helper.
- `PortableUpdater.ps1` waits for the app to exit, backs up runtime files, replaces only the verified allowlist, rolls back on any failure, and restarts the portable launcher.
- `ModuleService` verifies signed module packages, stages and atomically activates engine files, performs loopback health checks, tracks child processes, rolls back unhealthy replacements, and keeps shared module data separate from uninstallable engines.
- The renderer has context isolation enabled, Node integration disabled, sandboxing enabled, and a restrictive content security policy.

The built-in Portable Process Test proves the module lifecycle before the Kiwix engine is integrated.
