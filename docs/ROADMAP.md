# Roadmap

## Phase 8 - Local AI assistant

- Detect the connected computer before recommending or starting a model.
- Keep the portable llama.cpp runtime and explicitly selected GGUF models under `AI/`.
- Recommend a conservative model tier while still showing every available tier.
- Re-check compatibility on every host and lock an installed model when the current computer cannot safely run it.
- Keep model downloads, selection, and process startup explicit; local AI is never downloaded or enabled automatically.
- Search indexed documents and every language-compatible installed Kiwix library before generation, compact conversational questions into useful offline search phrases, pass only relevant read-only excerpts, and label the local sources used in each answer.
- Prefer the verified portable Vulkan runtime on a real GPU, retain CPU fallback across host changes, and never install drivers.
- Bound offline retrieval time and stream response text with visible search, generation, elapsed-time, and token-speed feedback.
- Supply the current host-reported local date, time, and timezone without requiring internet access; protect the loopback model API with a new random key each time it starts.
- Open AI document citations at the exact PDF page and Kiwix citations at the exact offline article; submit chat with Enter while retaining Shift+Enter for multiline prompts.
- Treat model startup as one operation, show its elapsed time, use a single inference slot, and allow slow cold reads from removable drives to finish without forcing a redundant CPU retry.
- Rank only confident multi-term document matches, recover conservative title misspellings and established related phrases, and reject weak one-word fallbacks.
- Give the model focused text from the matching PDF page plus adjacent-page context while keeping compact source cards in the interface.
- Retain the last substantive topic across short follow-ups, validate generated citation markers, and show a plain-language local search summary.
- Maintain regression prompts across survival, medical, repair, navigation, cybersecurity, follow-up, typo, and no-match cases.

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
- [x] Bundled offline English OCR for images and image-only PDF pages with progress, cancellation, and search indexing
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
- [x] Signed module lifecycle prototype completed and removed from production builds
- [ ] External downloadable module packages and module updates
- [x] Signed Kiwix Tools 3.8.1 Windows x64 engine descriptor
- [x] Verified portable Kiwix download, extraction, installation, repair, and uninstall
- [x] Recursive `Content/ZIM` scanning with engine/content separation
- [x] Loopback-only Kiwix process and integrated Library viewer
- [x] Small official OpenZIM test-library download
- [x] Current Kiwix catalog with dynamic languages/categories, grouped edition selection, exact release metadata, and pagination
- [x] Simplified Library workspace separating reading, adding content, and engine/file management
- [x] Live SHA-256 verification progress for large Kiwix downloads
- [x] Accelerated ordered range downloads with transparent single-stream fallback and SHA-256 authentication during transfer
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
- [x] In-app place search plus explicit location confirmation and Protomaps region downloads with radius/detail selection, size estimates, progress, cancellation, verification, automatic installation, and immediate map opening
- [x] Fully offline MapLibre viewer with pan, zoom, scale, and coordinate display
- [x] Saved places, custom markers, map notes, and favorites
- [x] Distance and bearing measurements
- [x] GPX waypoint/track-point import and saved-place export
- [x] Expanded Home search across documents, notes, and saved map places
- [x] Responsive Notes, Tools, and Maps layouts
- [ ] Custom user-authored map layers
- [ ] QR generation and image-based QR scanning
- [ ] File checksum picker and CSV/XML specialized viewers

## Phase 7 - Offline education

- [x] Drive-contained course folders with validated manifests and Markdown/text lessons
- [x] Native folder import that copies only declared lesson files
- [x] Offline lesson reader with course navigation and estimated duration
- [x] Portable SQLite completion tracking and progress summaries
- [x] Small optional starter course
- [x] Confirmed course removal scoped to the selected copied course
- [ ] Quiz question format and scored attempts
- [ ] Optional course media and captions
- [ ] Signed downloadable course catalog

## Planned phase - Printable road atlas and map literacy

- [ ] Add an Atlas mode to Maps that turns a user-selected region or route into printable, paper-style road-map pages from drive-contained map data.
- [ ] Let the user choose coverage, page size, scale, detail, orientation, and overlap before generating anything.
- [ ] Include an index grid, road and place labels, page references, north arrow, scale bar, coordinates, legend, and source attribution.
- [ ] Export and print an offline PDF without requiring an installed browser or an internet connection.
- [ ] Reuse installed PMTiles/MBTiles packages where coverage permits and clearly identify any additional user-chosen download needed for atlas generation.
- [ ] Add an Education Center course covering legends, scale, compass direction, coordinates, route planning, distance estimation, contour basics, and orienting a paper map.
- [ ] Include short offline practice exercises that use generated atlas pages and saved places.
- [ ] Validate map-data licensing, printed attribution, storage estimates, and legibility before making the feature generally available.

## Phase 9 - Portable media

- [x] Drive-contained video, audio, and image library with native file import and folder rescanning
- [x] In-app playback and image viewing without an installed browser
- [x] Search, type filters, editable titles, tags, collections, and favorites
- [x] Portable playback-position resume for audio and video
- [x] Confirmed deletion scoped to the selected media file
- [x] Media files and catalog data remain outside the application update boundary
- [ ] User-defined ordered playlists
- [ ] Optional offline thumbnail generation and codec helper package

## Phase 10 - Offline medication reference

- [x] Add a dedicated Medication Lookup page that works without internet or an installed browser
- [ ] Package searchable FDA drug-label and drug-listing data as an optional, drive-contained dataset
- [x] Search cached records by generic name, brand name, active ingredient, NDC, and manufacturer
- [x] Debounced FDA/local autocomplete with a single online-first search that falls back to saved records offline
- [x] Show official uses, warnings, contraindications, interactions, storage guidance, and retrieval provenance
- [x] Add portable pill matching by imprint, shape, color, and scored markings using current FDA/DailyMed SPL characteristics
- [x] Clearly distinguish exact imprint matches, partial imprint matches, possible pill matches, and unknown pills
- [ ] Show dataset source, publication date, and last portable update on every record
- [ ] Use signed, manually initiated dataset updates that never overwrite user data
- [ ] Keep searches, favorites, and personal reference notes entirely local
- [x] Add strong medical-safety messaging: reference only, never guarantee an unknown pill's identity, and never advise taking an unidentified medication
- [x] Require an unchecked reference-only acknowledgment before first use; do not enable lookup until the user affirmatively accepts it
- [x] Store acknowledgment locally and require it again when the disclaimer text materially changes
- [x] Keep a visible safety banner on lookup results and pill-identification screens, not only on the initial acknowledgment
- [ ] Have qualified legal and medical reviewers approve the final disclaimer, emergency guidance, terminology, and user flow before release
- [x] Confirm NLM Pillbox was retired and explicitly reject its stale static files for operational pill identification
- [x] Confirm Drugs.com offers the intended pill-finder workflow but prohibits automated extraction and dataset creation without prior written consent
- [x] Reject paid and scraping-dependent pill sources in favor of free FDA/DailyMed data
- [x] Bundle a compact FDA/DailyMed-derived NLM starter index so a new drive begins with broad offline coverage
- [ ] Add a maintainer refresh check for each monthly no-license-required RxNorm Prescribable Content release
- [ ] Add automated tests for exact-name lookup, imprint filtering, offline operation, provenance, update verification, and ambiguous/unknown results
