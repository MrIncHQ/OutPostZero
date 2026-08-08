# Portability Contract

The directory containing `.outpost-zero-root` is the portable root. Stored content paths must be relative to this root; drive letters and Linux mount paths are never canonical data.

All Outpost Zero-controlled data, configuration, identity, cache, temporary files, downloads, logs, indexes, models, and module state must remain beneath this root. A requested path that is absolute or escapes the root fails closed.

Windows releases are unpacked portable directory bundles. Copy the entire generated `OutpostZero-Windows-x64` folder to an external drive and run `Run_Outpost_Zero.bat`. A single self-extracting executable is intentionally avoided because it normally extracts application files into host temporary storage.

Host operating systems and security tools may still record that a removable drive or executable was used. Outpost Zero does not claim forensic invisibility.

Portable updates stage under `Updates/` and replace only application-owned runtime files after exit. User data under `Data/`, `Content/`, `Profile/`, `AI/`, `Modules/`, and the other protected roots is outside the update target allowlist.
