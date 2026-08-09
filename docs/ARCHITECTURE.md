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
- `KiwixService` verifies a signed, SHA-256-pinned upstream engine descriptor, downloads the official Windows archive, validates extraction, scans `Content/ZIM`, and owns a loopback-only `kiwix-serve` child process. It reads the official OPDS navigation and acquisition feeds, groups real Mini/Nopic/Maxi editions by archive, resolves official Metalink metadata, resumes portable-drive downloads, verifies SHA-256, and promotes content only after verification.
- `DocumentService` imports or scans portable documents, hashes copied files, extracts PDF text with the bundled PDF.js dependency, maintains exact page-level FTS indexes, and owns document metadata, bookmarks, notes, and annotations in SQLite.
- `NoteService` owns portable Markdown notes, FTS records, folders, tags, templates, and copied attachments. Exports are written only after an explicit native save-dialog choice.
- `MapService` validates and copies user-selected PMTiles/MBTiles archives, reads raster or vector MBTiles through SQLite, serves local tiles through range-aware internal protocols, and owns saved places plus GPX exchange.
- `UnifiedSearchService` combines exact-page document results, note FTS results, and saved map places into Home-page deep links.
- The Tools Center is a renderer-contained collection of deterministic calculators, converters, encoders, hashes, text utilities, and references; tool input is not persisted or transmitted.
- The `outpost-doc:` privileged internal protocol resolves validated document identifiers through the main-process portable path boundary. Electron's bundled Chromium PDF viewer renders those files inside Outpost Zero; no separately installed web browser is required.
- The `outpost-attachment:` and `outpost-map:` protocols resolve only database-owned portable records. Map archive byte ranges and MBTiles rows are served locally without opening a host browser or network listener.
- The renderer has context isolation enabled, Node integration disabled, sandboxing enabled, and a restrictive content security policy.

The built-in Portable Process Test proves the generic lifecycle. Kiwix uses the same engine/content separation while exposing its local viewer inside the Library interface.
