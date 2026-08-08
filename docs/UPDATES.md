# Portable Update Design

Outpost Zero updates must be downloaded, staged, verified, and applied entirely on the portable drive. Automatic checks are disabled by default.

The Update Center is connected to the source-free `MrIncHQ/OutPostZero` distribution repository. It performs network access only when the user explicitly selects **Check for Updates**.

The update flow:

1. Download `update-manifest.json` from GitHub.
2. Verify its Ed25519 signature against the public key pinned in the application.
3. Reject absolute paths, traversal, unknown runtime targets, and every protected user-data root.
4. Download changed runtime files into `Updates/Staging/<version>/`.
5. Verify every size and SHA-256 checksum.
6. Assemble and verify the executable from GitHub-compatible runtime parts.
7. Back up the portable database and start the external update helper.
8. Exit the main application.
9. Back up each runtime file before replacing it.
10. Verify each installed file and roll back all prior replacements if any step fails.
11. Record the installed version and restart Outpost Zero.

The updater's protected roots include `Data`, `Content`, `Profile`, `AI`, `Modules`, `Downloads`, `Exports`, `Backups`, `Config`, `Cache`, `Logs`, `Temp`, and `Updates`. A signed manifest still cannot target these locations.

The application must never execute an unsigned download or update host-installed software.
