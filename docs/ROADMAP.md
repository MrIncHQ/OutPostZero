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
- [x] Ed25519-signed GitHub update manifests
- [x] Per-file staged downloads and SHA-256 verification
- [x] Protected user-data update boundary
- [x] Runtime backup, rollback, and restart helper

## Phase 2 - Portable documents

- [x] Import supported files through a native in-app picker
- [x] Recursive scanning of `Content/PDFs` and `Content/Documents`
- [x] PDF, text, Markdown, HTML, and image library support
- [x] Bundled PDF parsing and reading without an installed browser
- [x] Exact PDF page text extraction and portable SQLite full-text indexing
- [x] Page-level document search and universal-search deep links
- [x] Favorites, recent reading, page progress, tags, and collections
- [x] Page bookmarks and notes
- [x] Separate annotations that never alter the source document
- [x] Confirmed single-document removal with source-copy protection
- [x] Responsive document library, reader, and inspector layout
- [ ] Optional OCR module for scanned images and image-only PDFs
- [ ] Optional Office conversion/preview module

## Update milestone follow-up

- [ ] Add byte-level download progress events
- [ ] Add a post-restart health acknowledgement and automatic stale-staging cleanup
- [ ] Add Linux update swap support

## Phase 3 - Module system

- [x] Signed module manifest and pinned module release key
- [x] Portable staging and per-file checksum verification
- [x] Atomic engine activation and failed-health rollback
- [x] Separate engine and shared-data ownership
- [x] Install, repair, start, stop, and safe uninstall controls
- [x] PID, loopback port, health, start time, and module logging
- [x] Graceful module shutdown during application exit and drive preparation
- [x] Tiny Portable Process Test module
- [ ] External downloadable module packages and module updates
- [x] Signed Kiwix Tools 3.8.1 Windows x64 engine descriptor
- [x] Verified portable Kiwix download, extraction, installation, repair, and uninstall
- [x] Recursive `Content/ZIM` scanning with engine/content separation
- [x] Loopback-only Kiwix process and integrated Library viewer
- [x] Small official OpenZIM test-library download
- [x] Current Kiwix catalog with dynamic languages/categories, grouped edition selection, exact release metadata, and pagination
- [x] Simplified Library workspace separating reading, adding content, and engine/file management
- [x] Live SHA-256 verification progress for large Kiwix downloads
- [x] Preserve Kiwix article response policies inside the embedded offline reader
- [x] Confirmed removal of individual ZIM libraries with safe reader restart
- [x] Reader-only My Library view with downloaded-file controls moved to Manage
- [x] Fluid full-screen Library layout with responsive catalog and management grids
- [x] App-wide fluid detail, status, settings, and update sections for wide displays
- [x] Portable large-download staging, pause/resume, live progress, free-space projection, and SHA-256 verification
- [ ] Catalog content updates, enable/disable controls, and explicit removal

## Phase 5 - Notes, tools, maps, and expanded search

- [x] Portable Markdown notes with autosave
- [x] Note folders, tags, pins, favorites, and reusable templates
- [x] Local note attachments with preview, confirmed removal, and Markdown export
- [x] Note full-text indexing and Home search deep links
- [x] Integrated scientific calculator and measurement converter
- [x] Text encoders/decoders, cryptographic hashes, JSON formatting, and Morse conversion
- [x] IPv4 subnet, coordinate, date/time, regex, diff, password, and periodic-reference tools
- [x] User-selected PMTiles and raster/vector MBTiles packages
- [x] In-app Protomaps region downloads with radius/detail selection, size estimates, progress, cancellation, verification, and automatic installation
- [x] Fully offline MapLibre viewer with pan, zoom, scale, and coordinate display
- [x] Saved places, custom markers, map notes, and favorites
- [x] Distance and bearing measurements
- [x] GPX waypoint/track-point import and saved-place export
- [x] Expanded Home search across documents, notes, and saved map places
- [x] Responsive Notes, Tools, and Maps layouts
- [ ] Custom user-authored map layers
- [ ] QR generation and image-based QR scanning
- [ ] File checksum picker and CSV/XML specialized viewers

## Phase 10 - Offline medication reference

- [ ] Add a dedicated Medication Lookup page that works without internet or an installed browser
- [ ] Package searchable FDA drug-label and drug-listing data as an optional, drive-contained dataset
- [ ] Search by generic name, brand name, active ingredient, purpose, and manufacturer
- [ ] Show official uses, warnings, contraindications, interactions, storage guidance, and label provenance
- [ ] Add pill identification by imprint, shape, color, and scored markings when a legally redistributable, authoritative dataset is confirmed
- [ ] Clearly distinguish exact label matches, possible pill matches, and unknown pills
- [ ] Show dataset source, publication date, and last portable update on every record
- [ ] Use signed, manually initiated dataset updates that never overwrite user data
- [ ] Keep searches, favorites, and personal reference notes entirely local
- [ ] Add strong medical-safety messaging: reference only, never guarantee an unknown pill's identity, and never advise taking an unidentified medication
- [ ] Require an unchecked reference-only acknowledgment before first use; do not enable lookup until the user affirmatively accepts it
- [ ] Store acknowledgment locally and require it again when the disclaimer text or medication dataset version materially changes
- [ ] Keep a visible safety banner on lookup results and pill-identification screens, not only on the initial acknowledgment
- [ ] Have qualified legal and medical reviewers approve the final disclaimer, emergency guidance, terminology, and user flow before release
- [ ] Research dataset licensing, redistribution rights, coverage, download size, and discontinued sources before implementation
- [ ] Add automated tests for exact-name lookup, imprint filtering, offline operation, provenance, update verification, and ambiguous/unknown results
