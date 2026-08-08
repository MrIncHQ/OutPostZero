# Security Model

- Electron context isolation and renderer sandboxing are enabled.
- Node integration is disabled in the renderer.
- IPC exposes only explicitly defined operations.
- Navigation and new windows are denied outside the development origin.
- A content security policy restricts executable content and network connections.
- Portable paths reject absolute paths and traversal outside the marked root.
- Device identities use Node's established Ed25519 implementation; private keys remain under `Profile/Identity` and are never exposed to the renderer.
- Display names are length-limited, stripped of control characters, and validated in the main process.
- Storage scans ignore symbolic links and remain scoped to declared portable directories.
- SQLite uses full synchronization, delete journaling, foreign keys, short migrations, integrity checks, and backups beneath `Backups/`.
- Update checks run only after explicit user action. GitHub manifests require a valid Ed25519 signature from the pinned release key, and every downloaded file requires a matching size and SHA-256 hash.
- Both the main process and external swap helper reject update targets under user-data roots. The signing private key remains local under ignored `ReleaseSigning/`; it is never packaged or uploaded.
- Module packages use a separate pinned Ed25519 key. The private module-signing key remains under ignored `ModuleSigning/`. Package files are checksum-verified in staging, runtime commands are allowlisted, and the first process module binds only to `127.0.0.1`.
- Module engines and shared data have separate ownership boundaries. Uninstall removes only `Modules/Installed/<module-id>`; data and logs remain unless a future explicit user choice removes them.
- The Kiwix descriptor pins the official archive size and SHA-256 hash inside a signed package manifest. ZIP paths are checked before extraction, extracted files are checked individually, and `kiwix-serve` starts with argument arrays, `--address=127.0.0.1`, and `--blockexternal`.
- Outpost Zero creates no services, scheduled tasks, firewall rules, registry configuration, or permanent environment changes.

Imported content and peer networking are not implemented yet and must receive dedicated threat modeling before release. The current module process test is intentionally loopback-only and contains no user content.
