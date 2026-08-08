# Portable Module Format

Outpost Zero module packages use an Ed25519-signed manifest. The manifest declares identity, version, supported platforms and architectures, download and installation sizes, owned and shared directories, dependencies, runtime command, health check, network policy, license, and per-file SHA-256 checksums.

The first package is the built-in `portable-process-test` module. It exists to prove the complete lifecycle before integrating Kiwix:

1. Verify the pinned package signature and every file checksum.
2. Reject absolute paths, traversal, unsupported hosts, unknown commands, and non-loopback networking.
3. Check portable-drive space and write only to a unique `Modules/Staging/` directory.
4. Move a prior engine to rollback staging and atomically activate the verified replacement.
5. Start the module with the portable host runtime and portable temp/data paths.
6. Require a valid health response from `127.0.0.1` before marking it installed.
7. Restore the previous engine if startup or health verification fails.

Module engines live under `Modules/Installed/<module-id>/`. Shared or user-created state lives separately under paths such as `Data/Modules/<module-id>/` and is not removed with the engine. Modules may not require host installation, elevation, or a hidden background service.
