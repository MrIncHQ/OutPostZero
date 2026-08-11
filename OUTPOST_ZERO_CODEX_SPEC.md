# Outpost Zero
## Portable Offline Knowledge, Library, Tools, and Communication Platform
### Codex Product & Engineering Specification

> **Product name:** Outpost Zero  
> **Primary tagline:** The world, offline.  
> **Secondary tagline:** Your world. Zero connection required.

---

# 1. Product Vision

Outpost Zero is a fully portable, offline-first application environment that lives entirely on a removable drive such as an external NVMe SSD, USB SSD, or sufficiently fast USB flash drive.

The user plugs the drive into a supported Windows or Linux computer, launches Outpost Zero directly from the drive, and immediately gains access to an integrated offline environment containing:

- offline knowledge libraries
- Wikipedia and other ZIM content
- a built-in PDF/document library and viewer
- universal full-text search
- offline maps
- education content
- notes
- utilities and data tools
- media/file viewing
- an optional local AI assistant
- optional AI document search
- encrypted peer-to-peer local-network chat
- encrypted local-network file transfer
- a portable module/content manager
- update and storage management
- hardware diagnostics and benchmarking

Outpost Zero is inspired by the broad offline capabilities of platforms such as Project N.O.M.A.D., but its architecture is fundamentally different.

Outpost Zero is **not installed onto the host computer**.

The portable drive is the system.

The host computer supplies temporary compute resources only:

```text
CPU
RAM
GPU
Display
Keyboard / Mouse
Network hardware
```

All persistent Outpost Zero application data must remain on the portable drive.

---

# 2. Non-Negotiable Rule

## THE PORTABLE DRIVE IS THE ENTIRE APPLICATION ENVIRONMENT

This rule overrides convenience.

Outpost Zero must never intentionally require or perform:

- MSI installation
- Windows application installation into Program Files
- apt/dnf/pacman/Homebrew installation
- WSL installation
- Docker or Docker Desktop installation
- system-wide Node.js installation
- system-wide Python installation
- system-wide Java installation
- system-wide database installation
- system-wide Kiwix installation
- system-wide AI runtime installation
- Windows services
- Linux systemd services
- scheduled tasks
- autostart entries
- permanent PATH changes
- permanent environment-variable changes
- registry configuration for Outpost Zero
- automatic firewall-rule creation
- host package-manager dependency installation
- permanent Outpost Zero files in AppData
- permanent Outpost Zero files in `.config`
- permanent Outpost Zero files in `.local`
- permanent Outpost Zero files in `/var`
- permanent Outpost Zero files in `/opt`

If a component cannot run entirely from the portable drive without a host installation, it does not qualify as an Outpost Zero module.

---

# 3. Accurate Portability Promise

Outpost Zero can guarantee that **Outpost Zero itself does not intentionally install or persist its own software/data on the host**.

It cannot promise that Windows, Linux, endpoint-security software, filesystem drivers, OS logging, recent-file systems, or similar host components will never record that:

- a removable drive was attached
- an executable was launched
- a LAN connection occurred

Do not market Outpost Zero as forensically invisible.

The correct promise is:

> Outpost Zero is zero-install and drive-contained. Its software, content, databases, settings, caches, models, logs, user libraries, and module data remain on the portable drive.

---

# 4. Supported Platforms

## Primary

- Windows 10/11 x64
- modern desktop Linux x64

## Future / Optional

- Linux ARM64
- Raspberry Pi 5 / ARM64 portable build if practical
- macOS only if the same containment guarantees can be met

Do not weaken the zero-install architecture merely to support another platform.

---

# 5. Recommended Drive Format

For a drive that regularly moves between Windows and Linux, recommend:

```text
exFAT
```

Also allow:

- NTFS
- ext4
- other filesystems when supported by the current host

Because removable drives can be unplugged unexpectedly:

- use short database transactions
- flush critical writes
- maintain a clean-shutdown marker
- detect unclean shutdown
- perform integrity checks after unsafe disconnect
- maintain rotating database backups on the portable drive
- provide a prominent **Prepare Drive for Removal** action

---

# 6. Portable Directory Layout

```text
OutpostZero/
│
├── OutpostZero.exe
├── OutpostZero-Linux
├── README.txt
├── .outpost-zero-root
│
├── Runtime/
│   ├── windows-x64/
│   ├── linux-x64/
│   └── linux-arm64/
│
├── App/
│
├── Modules/
│   ├── Installed/
│   ├── Manifests/
│   ├── Packages/
│   └── Staging/
│
├── Content/
│   ├── ZIM/
│   ├── Wikipedia/
│   ├── Medical/
│   ├── Survival/
│   ├── Repair/
│   ├── Education/
│   ├── Maps/
│   ├── PDFs/
│   ├── Books/
│   ├── Documents/
│   ├── Media/
│   └── Custom/
│
├── AI/
│   ├── Runtime/
│   ├── Models/
│   ├── Embeddings/
│   └── Indexes/
│
├── Profile/
│   ├── profile.json
│   └── Identity/
│
├── Data/
│   ├── outpost-zero.sqlite
│   ├── Search/
│   ├── Chat/
│   ├── Notes/
│   └── State/
│
├── Downloads/
├── Updates/
├── Cache/
├── Temp/
├── Logs/
├── Backups/
├── Exports/
└── Config/
```

---

# 7. Relative Path Rule

Never store the removable drive's absolute path as the canonical location of user content.

Bad:

```text
E:\OutpostZero\Content\PDFs\manual.pdf
```

Good:

```text
Content/PDFs/manual.pdf
```

All application-controlled paths must resolve relative to the Outpost Zero root.

The same drive must continue working if Windows changes it from `E:\` to `G:\`, or if Linux mounts it somewhere entirely different.

---

# 8. Portable Path Guard

Create a central service:

```text
PortablePathService
```

Every writable application path must come through this service.

At startup verify that all controlled writable locations resolve inside the portable root:

- user data
- browser/session data
- cache
- temporary files
- logs
- databases
- search indexes
- thumbnails
- module state
- AI models/cache/history
- chat history
- identity keys
- map cache
- PDF annotations
- downloads

If a writable application-controlled path escapes the portable root:

```text
FAIL SAFE
```

Do not silently continue.

---

# 9. Temporary Data

Outpost Zero should not intentionally use the host `%TEMP%`, `/tmp`, or equivalent for its application payloads.

Redirect Outpost Zero and child-process temporary directories toward:

```text
OutpostZero/Temp/
```

when supported.

Third-party modules must be configured to store their writable data and temporary files on the portable drive.

---

# 10. Runtime Architecture

Preferred initial stack:

- Electron
- React
- TypeScript
- SQLite
- bundled platform-specific sidecars when needed

Electron is acceptable because the product is intended to live on SSD/NVMe-class storage and bundling the browser runtime avoids depending on a separately installed host WebView.

Requirements:

- strict TypeScript
- context isolation
- no Node integration in untrusted renderer content
- strict CSP
- portable `userData` location
- portable cache location
- no hidden telemetry

Distribute as a portable application bundle, not an installer.

---

# 11. First Launch

## Welcome

```text
OUTPOST ZERO

THE WORLD, OFFLINE.

Everything you install, download, save,
index, or configure stays on this drive.

[ GET STARTED ]
```

## Local Identity

```text
LOCAL IDENTITY

Choose the name other Outpost Zero users
will see on your local network.

Username:
[ Steven________________ ]

No account or internet login is required.

[ CONTINUE ]
```

Generate the device cryptographic identity during setup.

---

# 12. Optional Component Selection

Optional applications/modules can be selected with checkboxes during first startup.

Example:

```text
OPTIONAL COMPONENTS

☑ Offline Library Engine
  Kiwix-compatible ZIM browsing

☑ Offline Maps
  Local map viewer

☑ Education Center
  Offline courses and learning content

☑ Advanced Tools
  Data conversion and utilities

☐ Local AI Assistant
  NOT installed by default

☐ AI Document Search
  Optional document question-answering

☐ OCR Pack
  Search scanned PDFs and documents

Required space: 1.2 GB
Available: 1.73 TB

[ INSTALL SELECTED TO THIS DRIVE ]

[ SKIP FOR NOW ]
```

## Critical AI Rule

AI must always be:

```text
UNCHECKED BY DEFAULT
```

No AI runtime or model is silently downloaded.

---

# 13. Module Center

All optional components are managed through one interface.

```text
MODULE CENTER

INSTALLED
────────────────────────────────
✓ Offline Library Engine
  [ Settings ] [ Update ] [ Uninstall ]

✓ Offline Maps
  [ Manage Content ] [ Update ] [ Uninstall ]

AVAILABLE
────────────────────────────────
○ Local AI Assistant
  [ Install ]

○ AI Document Search
  [ Install ]

○ OCR Pack
  [ Install ]

○ Education Center
  [ Install ]
```

Users can:

- install
- uninstall
- update
- repair
- enable
- disable
- inspect disk usage
- inspect version
- inspect license
- inspect dependencies

All module installation means:

> install onto the portable drive

Never onto the host computer.

---

# 14. Module Manifests

Each module has a machine-readable manifest defining:

```text
id
name
version
platforms
architectures
downloadSize
installSize
ownedDirectories
sharedDataDirectories
dependencies
runtimeCommand
healthCheck
networkPolicy
license
checksums
packageSignature
```

Modules requiring administrator/root access for installation are rejected unless a future feature explicitly supports a safe portable exception.

---

# 15. Safe Installation

```text
Download to portable drive
↓
Verify signature
↓
Verify checksum
↓
Check available space
↓
Extract to Modules/Staging
↓
Validate manifest
↓
Move atomically into Modules/Installed
↓
Run health check
↓
Mark installed
```

If installation fails:

- preserve previous working version
- clean staging
- report failure
- do not activate a partial install

---

# 16. Uninstallation

Uninstall module binaries separately from user content.

Example:

```text
UNINSTALL OFFLINE LIBRARY ENGINE

○ Remove engine only
  Keep downloaded ZIM libraries

○ Remove engine and downloaded library content

[ CANCEL ] [ UNINSTALL ]
```

AI follows the same model:

```text
○ Remove AI runtime only
○ Remove runtime and models
○ Remove runtime, models, embeddings, and AI history
```

Never silently delete user content.

---

# 17. Offline Knowledge Library

The Library is a native Outpost Zero section.

Suggested categories:

```text
Wikipedia
Medical
Survival
Repair
Books
Reference
Science
History
Travel
Education
Custom
```

The user should not need to understand which backend engine powers each source.

---

# 18. Kiwix / ZIM Integration

Kiwix is an optional module.

Engine:

```text
Modules/Installed/kiwix-engine/
```

Content:

```text
Content/ZIM/
```

Outpost Zero manages:

- Kiwix engine installation
- ZIM scanning
- content catalog
- language
- variants
- storage
- downloading
- versions
- updates
- removal
- integrated viewing

Avoid launching a separate-looking Kiwix application during normal use.

---

# 19. Wikipedia Version Selection

This is mandatory.

Never provide only:

```text
DOWNLOAD WIKIPEDIA
```

The user chooses the exact available archive.

Example:

```text
WIKIPEDIA — ENGLISH

Choose an edition:

○ MINI
  Smallest package
  Useful quick-reference edition

● NOPIC
  More complete text
  Images removed to save storage

○ MAXI
  Fullest standard archive
  Includes images
  Largest size

Release: current catalog date
Download: actual current file size
Free space after: calculated value

[ DOWNLOAD TO OUTPOST ZERO ]
```

Important:

- fetch actual current catalog metadata when internet is available
- never hard-code archive sizes
- show release date
- show exact file/download size
- show available free space
- explain each edition
- only display archive variants that actually exist

---

# 20. Multiple Knowledge Archives

Allow many archives simultaneously:

```text
Wikipedia English - Maxi
Wikipedia English - Mini
Wikipedia Spanish - Nopic
Wiktionary English
Wikivoyage English
WikiMed
Wikibooks
Wikisource
Project Gutenberg
Stack Exchange archives
other compatible ZIM content
```

Each can be independently:

- installed
- enabled
- disabled
- updated
- removed

---

# 21. Storage Planner

Before large downloads:

```text
SELECTED CONTENT

Wikipedia English Maxi      XX.X GB
WikiMed                      XX.X GB
Wiktionary                    X.X GB
Missouri Maps                 X.X GB
──────────────────────────────────
Total                        XX.X GB

Free now                    XXX.X GB
Free after                  XXX.X GB

[ DOWNLOAD ]
```

Show storage categories:

- knowledge
- maps
- documents
- education
- AI
- media
- cache
- free space

---

# 22. Download Manager

Features:

- queue
- pause
- resume where supported
- cancel
- retry
- progress
- speed
- downloaded bytes
- remaining bytes
- checksum verification
- low-space warnings
- concurrent-download settings

All download staging stays on the portable drive.

---

# 23. Built-In Document Library

Documents are a flagship Outpost Zero feature.

Core formats:

- PDF
- TXT
- Markdown
- HTML
- images

Extended:

- EPUB
- CSV
- DOCX preview
- XLSX preview

Do not require Microsoft Office or LibreOffice.

---

# 24. PDF Viewer

Use PDF.js or another self-contained open-source viewer.

Required features:

- thumbnails
- page navigation
- table of contents
- text selection
- search within PDF
- zoom
- fit width/page
- rotate
- fullscreen
- continuous scroll
- single-page
- two-page view
- bookmarks
- favorites
- recently viewed
- reading progress
- page history
- deep linking from search results
- metadata
- tags
- collections
- notes
- annotations stored separately from original PDF
- print when host printing is available
- optional export

Do not modify the source PDF unless the user explicitly requests an export.

---

# 25. Document Organization

```text
DOCUMENTS

All Documents
Recently Opened
Favorites

COLLECTIONS
Medical
Survival
Vehicle Manuals
Generators
Electronics
Homestead
Legal
History
Personal Reference

TAGS
first-aid
engine
wiring
water
food
repair
```

---

# 26. Document Indexing

For text PDFs:

- extract text
- index locally
- preserve page mappings
- store index on the portable drive

Example search result:

```text
Small Engine Repair Manual
Page 184

"...carburetor flooding..."

[ OPEN PAGE 184 ]
```

---

# 27. OCR Pack

OCR is optional.

Do not bundle a large OCR runtime into the base package unless lightweight enough to justify.

Optional module:

```text
OCR PACK
```

Capabilities:

- identify image-only PDFs
- OCR individual document
- OCR queue
- index extracted text
- preserve page mapping
- never modify source PDF automatically

---

# 28. Universal Search

Universal Search works without AI.

Search across:

- PDFs
- text documents
- Markdown
- notes
- indexed books
- ZIM sources where feasible
- saved map places
- media metadata
- education metadata
- saved chat history
- filenames
- tags
- collections

Recommended base:

```text
SQLite FTS5
```

Search filters:

```text
Everything
Documents
Knowledge
Maps
Notes
Learning
Media
Chat
```

---

# 29. Notes

Integrated notes system:

- Markdown
- folders
- tags
- pinned notes
- favorites
- autosave
- full-text search
- templates
- local attachments
- Markdown export

No cloud account required.

---

# 30. Offline Maps

Recommended:

- MapLibre
- PMTiles and/or MBTiles
- OpenStreetMap-derived offline packages

Features:

- pan/zoom
- saved places
- custom markers
- coordinate display
- copy coordinates
- measure distance
- measure bearing
- GPX import/export
- map notes
- favorites
- custom layers later

Map data is always user-selected.

---

# 31. Education Center

Match the useful offline-education capabilities of Project N.O.M.A.D.

Possible backend:

- portable Kolibri module if it can remain fully drive-contained

If not, use a TerraRelay-native-style content approach under the Outpost Zero interface.

Features:

- courses
- lessons
- videos
- quizzes where supported
- progress
- favorites
- future multiple learner profiles

No internet account required.

---

# 32. Tools Center

Built-in offline utilities may include:

- calculator
- scientific calculator
- unit converter
- date/time calculator
- coordinate converter
- subnet calculator
- Base64
- URL encoder/decoder
- text encodings
- ASCII/hex
- hashes
- file checksums
- QR generator
- QR reader
- JSON formatter
- XML formatter
- CSV viewer
- regex tester
- diff viewer
- password generator
- timestamp converter
- Morse code
- periodic table/reference

Advanced transformation tools can be integrated similarly to CyberChef without presenting a disconnected dashboard.

---

# 33. Files

Provide a lightweight file browser primarily scoped to the portable drive.

Sections:

```text
Documents
Images
Audio
Video
Archives
Downloads
Exports
Custom
```

Features:

- search
- sort
- preview
- rename
- move
- copy
- delete with confirmation
- open using Outpost Zero
- reveal portable relative path

Host-drive browsing must require explicit user action.

Never automatically index the host computer.

---

# 34. Media

Basic offline media library:

- video
- audio
- images
- playlists
- metadata
- favorites
- collections

Current implementation: media files are copied into `Content/Media`; the portable catalog, tags, collections, favorites, and playback resume state are stored under `Data/Media`. The Electron reader serves them through an internal drive-only protocol and does not require an installed browser. Ordered playlists and optional codec/thumbnail helpers remain follow-up work.

A bundled FFmpeg module may be used where necessary.

Never require host FFmpeg installation.

TVCommander may later become an optional integration/module, but it is not part of the initial Outpost Zero MVP.

---

# 35. AI Is Optional

The base Outpost Zero package must not include a large AI runtime/model by default.

Outpost Zero works fully without AI.

When AI is not installed:

```text
LOCAL AI IS NOT INSTALLED

Outpost Zero can run AI entirely from this portable drive.

Nothing will be installed onto this computer.

[ SET UP LOCAL AI ]
[ NOT NOW ]
```

---

# 36. AI Setup

Detect:

- CPU
- RAM
- GPU
- VRAM where available
- OS
- architecture
- available drive space

Then show appropriate choices:

```text
FAST
Small model
Low memory

BALANCED
7B / 8B class model
Recommended where appropriate

ADVANCED
Larger model
Higher hardware requirements
```

Display real metadata:

- model name
- publisher
- license
- parameter count
- quantization
- download size
- approximate RAM requirement
- context size
- compatibility

Never silently choose and download a huge model.

---

# 37. Portable AI Runtime

Preferred:

- llama.cpp-compatible GGUF runtime
- platform-specific portable binaries

Potential runtime packages:

```text
Windows CPU
Windows CUDA
Windows Vulkan
Linux CPU
Linux CUDA
Linux Vulkan
Linux ARM64
```

Never install drivers.

If GPU acceleration is unavailable, use CPU fallback when practical.

Models remain portable:

```text
AI/Models/
```

The same GGUF model should normally work across Windows/Linux with different platform runtimes.

---

# 38. AI Document Search

Optional AI/RAG can use:

- PDFs
- documents
- notes
- selected ZIM content
- user-selected collections

Responses must cite local sources.

Example:

```text
Sources

1. Small Engine Repair Manual — p. 184
2. Generator Service Guide — p. 72
```

Click source to open the exact document/page.

Never invent local citations.

---

# 39. Local Relay

Outpost Zero includes encrypted local communication between nearby Outpost Zero instances.

Feature name:

```text
LOCAL RELAY
```

No cloud server.

No internet required.

No user account.

---

# 40. User Identity

The user chooses a display username:

```text
Steven
```

The username is not a security credential.

Each portable drive generates its own persistent cryptographic identity stored only on the drive.

---

# 41. Cryptographic Identity

Use mature cryptographic libraries.

Do not invent custom cryptography.

Preferred design direction:

- persistent signing identity
- authenticated handshake
- ephemeral session keys
- forward secrecy where practical
- AEAD encryption
- replay protection

Suitable protocol/libraries can use proven implementations of:

- Noise Protocol
- X25519
- Ed25519
- XChaCha20-Poly1305

Exact selection should depend on the mature library chosen.

---

# 42. Peer Verification

Example:

```text
FIRST TIME CONNECTING TO RICHARD

Verification code:

BLUE - HORSE - 742

Compare this code with Richard.

[ MARK VERIFIED ]
[ CONTINUE UNVERIFIED ]
```

Also expose a device fingerprint.

If a previously verified peer's identity changes:

```text
WARNING
Richard's device identity has changed.
```

Never silently trust the replacement key.

---

# 43. LAN Discovery

Discover Outpost Zero peers using suitable local-network methods:

- mDNS
- UDP multicast/broadcast
- subnet discovery fallback if appropriate

Discovery messages expose only necessary metadata.

Never broadcast chat content.

---

# 44. Host Firewall

Outpost Zero must never automatically create firewall rules.

If peer communication is blocked:

```text
Local Relay is blocked by the host firewall.

Outpost Zero will not change this computer's firewall settings.
```

Do not request elevation merely to make LAN chat work.

---

# 45. Direct Messages

MVP:

- encrypted one-to-one messaging
- peer presence
- timestamps
- unread state
- delivery state
- verification status
- LAN-only operation
- no central server

---

# 46. Local Room

Provide a shared local room.

```text
LOCAL ROOM                    4 ONLINE

Steven:
Generator is running.

Richard:
Does anyone have the service manual?

Workshop:
I have it.

Steven:
Sending it now.
```

For MVP, use pairwise encrypted sessions and fan out group messages separately to each peer instead of inventing custom group encryption.

---

# 47. Chat History

User setting:

```text
Chat history

● Save messages on this portable drive
○ Do not retain messages after session
```

Saved data remains under:

```text
Data/Chat/
```

---

# 48. Encrypted File Transfer

Support direct encrypted file transfer between Outpost Zero instances.

```text
Richard wants to send:

Honda-Generator-Service-Manual.pdf
12.8 MB

[ DECLINE ] [ SAVE TO LIBRARY ]
```

Requirements:

- encrypted
- direct LAN transfer
- chunked
- progress
- cancel
- hash verification
- user-selected destination
- destination defaults to portable drive
- never stage on host storage
- never execute incoming files automatically

---

# 49. Interface Direction

Outpost Zero should not look like:

- Project N.O.M.A.D.
- a generic admin dashboard
- a wall of app tiles
- Plex
- Windows Settings
- a Linux control panel
- a fake hacker terminal
- a military-game HUD

Design concept:

> **Portable Knowledge Outpost**

It should feel like a polished field library and communication station.

---

# 50. Visual Style

Suggested characteristics:

- strong, distinctive typography
- layered information panels
- subtle topographic-line motifs
- subtle signal/network visual language
- archive/library visual language
- excellent light and dark modes
- smooth restrained transitions
- keyboard friendly
- touchscreen friendly
- high contrast and readability

Suggested direction:

- graphite/slate structure
- warm paper-like document surfaces
- amber system/status accent
- cool teal/cyan communication accent

Do not sacrifice usability for visual style.

---

# 51. Suggested Navigation

```text
Home
Search
Library
Documents
Maps
Learning
Notes
Media
Local Relay
Tools
Modules
Downloads
Settings
```

After optional AI installation:

```text
AI Assistant
```

AI should not dominate the interface if it is not installed.

---

# 52. Home Screen

Prioritize:

1. Universal Search
2. Continue Reading / Recent
3. Storage status
4. Installed knowledge summary
5. nearby Local Relay peers
6. unread messages
7. active downloads
8. important warnings

Avoid equal-sized dashboard tiles.

---

# 53. Global Status Strip

Example:

```text
OFFLINE | 3 OUTPOSTS NEARBY | 1.7 TB FREE | 2 DOWNLOADS | AI: NOT INSTALLED
```

Terminology can reinforce the brand.

Instead of:

```text
3 users online
```

consider:

```text
3 Outposts Nearby
```

---

# 54. Offline-First UX

Offline is the normal operating state.

Do not show offline status as a red error.

Use a calm status:

```text
OFFLINE
```

Only online-only actions should explain that internet access is required.

---

# 55. Hardware Diagnostics

Display:

```text
SYSTEM

CPU
RAM
GPU
VRAM
Operating System
Architecture

PORTABLE DRIVE
Filesystem
Capacity
Free Space
Read Speed
Write Speed

LOCAL NETWORK
Local IP
Nearby Outposts
Local Relay status

AI
Not installed
Hardware recommendations
```

All hardware data remains local by default.

---

# 56. Storage Inspector

Example:

```text
Knowledge              412 GB
Maps                    126 GB
Documents                84 GB
Education                61 GB
AI Models                18 GB
Media                   510 GB
Search Indexes            9 GB
Cache                     3 GB
Free                    777 GB
```

Allow drill-down and cleanup.

Never automatically delete user documents.

---

# 57. Updates

Updates are written to the portable drive only.

Categories:

```text
Outpost Zero Core
Modules
Offline Content
AI Models
Map Packages
Education Content
```

Large content updates require user confirmation by default.

---

# 58. Portable Self-Update

Use a tiny portable launcher/updater.

```text
Download new version to Updates/
↓
Verify signature/checksum
↓
Exit main app
↓
Swap application directory
↓
Start new version
↓
Health check
↓
Rollback on failure
```

Keep a previous working version when storage permits.

---

# 59. Privacy

Default:

- no telemetry
- no account
- no cloud storage
- no tracking
- no advertising IDs
- no hidden analytics
- no automatic crash uploads

A future diagnostic submission must be explicit and previewable.

---

# 60. Prepare Drive for Removal

Include a visible command:

```text
PREPARE DRIVE FOR REMOVAL
```

It should:

1. stop downloads
2. flush notes
3. flush chat/history
4. stop networking
5. stop module processes
6. close AI model/runtime
7. close databases
8. flush/checkpoint indexes
9. clear safe temp files
10. write clean-shutdown marker
11. report that Outpost Zero is ready to close/eject

---

# 61. Crash Recovery

At startup, if last shutdown was not clean:

- run database checks
- inspect incomplete downloads
- clean stale staging
- inspect update state
- clean orphan temp files
- report only meaningful problems

---

# 62. Process Manager

Outpost Zero tracks child module processes:

```text
Module
PID
Port
Start time
Health
Memory
Logs
```

When the main app exits:

- gracefully stop every child process
- flush module data
- confirm no Outpost Zero process is intentionally left running

No hidden background service.

---

# 63. Internal Networking

Internal module services should bind to:

```text
127.0.0.1
```

unless a feature specifically requires LAN access.

Do not expose:

- Kiwix internals
- AI runtime
- databases
- admin API
- map server

to the LAN by default.

Local Relay is the intentional peer-network feature.

---

# 64. Database

Use:

```text
SQLite
```

Do not require:

- MySQL
- PostgreSQL
- Redis

Maintain:

- migrations
- backups
- integrity checks
- short transactions
- removable-drive-safe recovery

Separate rebuildable search indexes from critical metadata where sensible.

---

# 65. Custom Content

Users can add files manually:

```text
Content/PDFs/
Content/ZIM/
Content/Books/
Content/Maps/
Content/Media/
```

Then select:

```text
SCAN CONTENT
```

Also support drag/drop and file/folder import.

When importing from the host, default to:

```text
Copy into Outpost Zero
```

so the library remains portable.

---

# 66. Future Portable Module SDK

Later, allow third-party modules.

Every module must:

- ship its own runtime
- use relative paths
- declare writable paths
- declare network requirements
- require no host installation
- require no elevation
- uninstall cleanly
- provide a health check
- provide license metadata

This replaces a Docker-centric extension model.

---

# 67. Development Phases

## Phase 0 — Prove Portability

Implement:

- root detection
- PortablePathService
- portable Windows launcher
- portable Linux launcher
- portable data/cache/temp paths
- clean shutdown
- containment tests

Acceptance:

> Launching Outpost Zero creates every Outpost Zero-controlled persistent file beneath the portable root.

Do not begin complex modules until this passes.

## Phase 1 — Core Shell

Implement:

- unique application shell
- first-run profile
- username
- device cryptographic identity
- settings
- SQLite
- storage inspector
- hardware info
- Module Center skeleton

## Phase 2 — Documents

Implement:

- PDF library
- PDF viewer
- metadata
- collections/tags
- text extraction
- full-text search
- page-level deep links
- bookmarks
- annotations

## Phase 3 — Module System

Implement:

- manifests
- package verification
- staging
- install
- repair
- update
- rollback
- uninstall

Use a tiny test module first.

## Phase 4 — Kiwix / ZIM

Implement:

- portable Kiwix engine module
- ZIM scanning
- integrated browser
- catalog
- language filter
- Wikipedia edition selection
- actual current file sizes
- download manager
- update/remove

## Phase 5 — Notes / Tools / Maps

Implement integrated notes, tools, offline maps, and expanded universal search.

## Phase 6 — Local Relay

Implement:

- peer discovery
- identity keys
- encrypted handshake
- direct messaging
- verification
- Local Room
- encrypted file transfer

## Phase 7 — Education

Add a fully drive-contained offline education solution.

## Phase 8 — Optional AI

Only then implement:

- hardware detection
- AI installer
- portable runtime
- model catalog
- model management
- local AI chat
- optional embeddings
- document RAG

## Phase 9 — Updates / Polish

Implement:

- portable updater
- module updates
- content update workflows
- recovery
- storage tools
- accessibility
- packaging
- documentation
- update and release hardening
- responsive-layout polish
- final portable-drive validation

## Phase 10 — Offline Medication Reference

Add a dedicated Medication Lookup page designed to remain useful without internet access or an installed browser.

Implement:

- optional portable FDA drug-label and drug-listing dataset packages
- search by generic name, brand name, active ingredient, purpose, and manufacturer
- official uses, warnings, contraindications, interactions, storage guidance, and source provenance
- pill identification filters for imprint, shape, color, and scored markings only after confirming an authoritative dataset with redistribution rights
- explicit exact, possible, ambiguous, and unknown match states
- visible dataset publication and portable-update dates
- signed, user-initiated dataset updates
- local favorites and personal reference notes
- no diagnosis, prescribing, or guarantee that an unknown pill is safe to take
- a blocking, unchecked reference-only acknowledgment before first use
- local acknowledgment records tied to the accepted disclaimer and dataset versions
- required re-acceptance after material disclaimer or dataset changes
- persistent safety warnings on drug results and pill-identification screens

The acknowledgment must state in plain language that the information is an offline reference, may be incomplete or outdated, does not provide diagnosis or prescribing advice, cannot guarantee pill identity, and must not be used as permission to take an unknown medication. The lookup interface remains inaccessible until the user affirmatively checks the acknowledgment and continues. Acceptance stays local to the portable drive and must be requested again when the disclaimer or underlying medication dataset materially changes.

Before implementation, verify dataset licensing, redistribution rights, coverage, size, update cadence, and whether any proposed pill-identification source has been discontinued or replaced. Medication data must be treated as high-stakes reference material and tested for provenance, offline availability, ambiguous results, acknowledgment enforcement, and update integrity. Qualified legal and medical reviewers must approve the final disclaimer, emergency guidance, terminology, and user flow before release; the acknowledgment is not a substitute for reliable data or safe behavior.

Implementation note: official openFDA drug-label results can be retrieved on explicit user searches and are cached under `Data/Medication` for later offline use. Current FDA/DailyMed SPL characteristics provide imprint, color, shape, size, score, product name, and NDC data. Outpost Zero can retrieve these characteristics by medication name or NDC, save them on the portable drive, and perform later imprint matching entirely offline. Matches must be presented as possible matches rather than verified identity because coverage depends on labeler submissions and the government services do not provide a reverse-imprint search endpoint.

Starter-index note: portable Windows builds include a compact index generated from the no-license-required NLM RxNorm Current Prescribable Content release. Only `MTHSPL` physical-characteristic fields needed for matching are retained; full terminology files and pill photographs are excluded. The bundled starter index is runtime-owned and may be replaced by application updates, while user-downloaded medication labels and pill records remain under `Data/Medication` and outside the update boundary.

Drugs.com currently provides a polished imprint/color/shape/image pill-finder experience, but its published terms prohibit automated extraction, storage, and dataset creation without prior written consent. Its pill-identification material also combines multiple licensed sources. Do not scrape or redistribute that database. The project will remain free by using FDA/DailyMed factual characteristics and will not redistribute labeler-supplied photographs unless their rights are separately confirmed.

---

# 68. Critical Automated Tests

## Drive Letter Change

Launch from:

```text
E:\OutpostZero
```

Move to:

```text
G:\OutpostZero
```

Everything must still work.

## Linux Mount Change

Launch from an arbitrary mount location.

No Windows-style absolute path may matter.

## Host Containment

Fail the test if an Outpost Zero-controlled persistent write occurs outside the test root.

## Module Uninstall

Module-owned files disappear.

Shared/user content remains.

## Dirty Shutdown

Simulate unsafe termination.

Next startup recovers safely.

## PDF Search

Search a known phrase.

Correct document/page is returned.

## Kiwix Offline

Browse a ZIM with internet disabled.

## Local Relay

Two instances:

- discover one another
- establish authenticated encrypted session
- reject modified ciphertext
- reject replay
- detect identity-key change

## File Transfer

Transferred destination hash equals source hash.

---

# 69. Security Rules

- never invent crypto
- use established cryptographic libraries
- validate IPC
- context isolation
- sanitize paths
- block traversal attacks
- treat imported HTML/ZIM/document content as untrusted
- never auto-execute received files
- verify module signatures
- verify update signatures
- prefer process argument arrays over shell strings
- avoid shell execution
- keep internal services on loopback
- use random internal tokens where useful
- no open database ports
- no default LAN admin interface
- no telemetry by default
- no secrets in logs

---

# 70. Codex Engineering Rules

When implementing Outpost Zero:

1. Inspect the repository first.
2. Maintain `docs/ARCHITECTURE.md`.
3. Maintain `docs/PORTABILITY.md`.
4. Maintain `docs/SECURITY.md`.
5. Maintain `docs/MODULE_FORMAT.md`.
6. Maintain `docs/ROADMAP.md`.
7. Keep zero-install requirements visible.
8. Add tests before major expansion.
9. Run builds/tests after meaningful changes.
10. Fix build/runtime problems before claiming completion.
11. Do not install host software merely because it is easier.
12. Bundle required application-specific runtimes.
13. Never make Docker a product requirement.
14. Never make WSL a product requirement.
15. Never make MySQL/Postgres/Redis a core requirement.
16. Never make AI mandatory.
17. Never silently substitute cloud services for offline features.
18. Never create automatic firewall rules.
19. Never place Outpost Zero-controlled persistent files outside the portable root.

---

# 71. Decision Priority

When requirements conflict, prioritize:

1. portable-drive containment
2. user-data safety
3. offline functionality
4. security
5. Windows/Linux portability
6. clean install/update/uninstall
7. user experience
8. performance
9. feature breadth

A convenient feature that violates portability loses.

---

# 72. What Makes Outpost Zero Different

Outpost Zero is not:

```text
a dashboard linking to unrelated self-hosted applications
```

The user should experience:

```text
one launcher
one interface
one universal search
one content manager
one storage manager
one module manager
one local identity
one encrypted local communication system
one portable drive
```

Underlying open-source engines should feel invisible during normal use.

---

# 73. Product Personality

Outpost Zero should feel:

- capable
- independent
- polished
- dependable
- private
- exploratory
- useful both online and offline

Avoid apocalypse-only branding.

It should make sense for:

- travel
- research
- education
- workshops
- cabins
- field work
- camping
- unreliable internet
- home reference
- emergency preparedness
- portable digital archives

---

# 74. Brand Language

Use the Outpost concept carefully throughout the product.

Examples:

```text
Nearby Outposts
3 Outposts Online
Connect to Outpost
Verify Outpost
Outpost Library
Outpost Status
Prepare Outpost for Removal
```

Do not overuse the terminology where normal language is clearer.

---

# 75. Branding

## Name

# OUTPOST ZERO

Interpretation:

**Outpost**  
A self-contained point of knowledge, tools, resources, and communication that can operate independently.

**Zero**  
Zero required internet connection.  
Zero required host installation.  
Zero cloud dependency for core operation.

## Primary Tagline

> **The world, offline.**

## Alternate Taglines

> Your world. Zero connection required.

> Knowledge without the network.

> Carry the world with you.

> Plug in. Go offline.

> Knowledge. Tools. Connection. Anywhere.

---

# 76. Startup Concept

```text
OUTPOST ZERO

THE WORLD, OFFLINE.

Knowledge • Maps • Documents • Local Relay

Preparing portable environment...
```

Keep startup elegant.

Do not imitate:

- BIOS screens
- terminals
- military interfaces
- generic server dashboards

---

# 77. MVP Success Definition

Outpost Zero succeeds when a user can:

1. place it on an external SSD/NVMe;
2. plug the drive into Windows;
3. launch without installation;
4. safely close/remove it;
5. plug the same drive into Linux;
6. launch with the same profile, content, and settings;
7. install optional modules to the portable drive;
8. uninstall those modules cleanly;
9. choose which Wikipedia/Kiwix language and edition to download;
10. see actual current archive sizes before downloading;
11. maintain multiple knowledge archives;
12. browse all installed content offline;
13. add and search thousands of PDFs;
14. open search results directly to the correct PDF page;
15. use notes, maps, tools, education, and media offline;
16. use the entire core application without AI;
17. optionally install AI later to the drive;
18. move that AI environment with the drive;
19. discover nearby Outpost Zero systems on the LAN;
20. verify peer identities;
21. exchange encrypted messages;
22. exchange encrypted files;
23. update modules/content without host installation;
24. prepare the drive for safe removal.

---

# 78. First Instruction to Codex

Do **not** begin by implementing AI, Kiwix, maps, education, or Local Relay.

Begin by proving portability.

The first milestone is:

> A minimal Outpost Zero shell that launches from arbitrary Windows and Linux paths, stores every Outpost Zero-controlled writable file beneath its portable root, survives drive-letter/mount-point changes, shuts down cleanly, and leaves no intentional Outpost Zero services or application data installed on the host.

Only after this milestone is covered by automated tests should development proceed to the Document Library and Module Center.

# PORTABILITY IS THE PRODUCT.

Everything else sits on top of it.
