# Portable Update Design

Outpost Zero updates must be downloaded, staged, verified, and applied entirely on the portable drive. Automatic checks are disabled by default.

The Update Center is connected to the source-free `MrIncHQ/OutPostZero` distribution repository. It performs network access only when the user explicitly selects **Check for Updates**.

Version 0.15.4 is the permanent bridge from the original mutable update layout. The repository-root manifest and runtime files are frozen at that version so an older Outpost installation can always finish that update safely. Version 0.15.4 and later read `UpdateChannel/update-manifest.json`; every signed manifest names an immutable `runtime-v<version>` Git tag, and every file is downloaded from that tag. A later publication may update the channel manifest only after its immutable runtime tag is available. It must never replace the bridge files or move/reuse an existing runtime tag.

The update flow:

1. Download `UpdateChannel/update-manifest.json` from GitHub.
2. Verify its Ed25519 signature against the public key pinned in the application.
3. Require the signed immutable release reference to exactly equal `runtime-v<version>`.
4. Remove any obsolete updater-owned pending record and staging directory from an older version.
5. Reject absolute paths, traversal, unknown runtime targets, and every protected user-data root.
6. Confirm the portable drive has enough free space for staging, assembly, and rollback.
7. Download changed runtime files from the immutable release tag into `Updates/Staging/<version>/`.
8. Verify every size and SHA-256 checksum.
9. Assemble and verify the executable from GitHub-compatible runtime parts.
10. Back up the portable database and start the external update helper.
11. Exit the main application.
12. Back up each runtime file before replacing it.
13. Verify each installed file and roll back all prior replacements if any step fails.
14. Record the installed version and restart Outpost Zero.

The updater's protected roots include `Data`, `Content`, `Profile`, `AI`, `Modules`, `Downloads`, `Exports`, `Backups`, `Config`, `Cache`, `Logs`, `Temp`, and `Updates`. A signed manifest still cannot target these locations.

The application must never execute an unsigned download or update host-installed software.
