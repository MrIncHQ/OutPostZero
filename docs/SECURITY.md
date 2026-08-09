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
- Kiwix catalog access accepts acquisition metadata only from the official HTTPS catalog and load-balancer hosts. Large ZIM files remain as partial files under `Downloads/Kiwix` until the official Metalink size and SHA-256 checksum pass; a same-named user ZIM is preserved rather than overwritten.
- Document imports copy only explicitly selected supported files into portable content roots. Recursive scans ignore symbolic links, document IDs are validated, and every reader path is resolved beneath the marked portable root.
- The internal `outpost-doc:` protocol is restricted to known database records. Document page text, bookmarks, notes, and annotations remain in the portable SQLite database; annotations never modify source files.
- PDF text extraction uses bundled application code and PDF viewing uses Electron's bundled Chromium runtime. Documents never require or launch a host-installed browser.
- Notes and copied attachments stay beneath portable roots. Attachment IDs are validated in the main process, Markdown is rendered without raw HTML execution, and deletions are scoped to the selected note record and attachment directory.
- Offline map imports accept only validated PMTiles/MBTiles files chosen through a native dialog. Symbolic links are not scanned, custom protocol byte ranges are bounded, MBTiles SQL is fixed and read-only, and no online basemap is contacted.
- Saved map places and tool input remain local. Tools do not use dynamic code evaluation; scientific expressions are handled by a restricted parser.
- Outpost Zero creates no services, scheduled tasks, firewall rules, registry configuration, or permanent environment changes.

Peer networking is not implemented yet and must receive dedicated threat modeling before release. The current module process test is intentionally loopback-only and contains no user content.
