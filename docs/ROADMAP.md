# Roadmap

## Phase 0 - Prove portability

- [x] Root marker detection
- [x] Central portable path guard
- [x] Portable data, cache, temp, and log paths
- [x] Clean/unclean shutdown marker
- [x] Minimal secure Electron shell
- [x] Relocation and traversal tests
- [x] Packaged Windows runtime smoke test beneath a generated release root
- [ ] Runtime host-write audit on packaged Windows build
- [ ] Test from an external drive and a changed drive letter
- [ ] Portable Linux x64 packaging and mount-change test

## Next

After Phase 0 acceptance, build the first-run profile and local identity, SQLite metadata, storage inspection, and Module Center skeleton. Documents and full-text search follow after the core shell.

## Phase 1 - Core shell

- [x] First-run local identity setup
- [x] Persistent Ed25519 device identity
- [x] Editable display name
- [x] Working application navigation
- [x] Live storage category inspection
- [x] Module Center catalog foundation
- [x] Clear locked states for unimplemented modules
- [x] SQLite critical metadata and migrations
- [x] SQLite integrity checks and rotating portable backups
- [x] Hardware diagnostics
- [x] Update Center with automatic checks disabled
- [x] Future GitHub Releases provider model

## Update milestone prerequisites

- [ ] Publish the stable base repository
- [ ] Configure the GitHub owner and repository
- [ ] Define and sign the release manifest format
- [ ] Verify package signatures and checksums
- [ ] Apply updates through staging with health checks and rollback
