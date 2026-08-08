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
- Update checks are disabled until a source is explicitly configured. Future packages must use signed manifests and verified checksums before activation.
- Outpost Zero creates no services, scheduled tasks, firewall rules, registry configuration, or permanent environment changes.

Imported content, modules, cryptographic identity, and local networking are not implemented yet and must receive dedicated threat modeling before release.
