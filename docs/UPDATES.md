# Portable Update Design

Outpost Zero updates must be downloaded, staged, verified, and applied entirely on the portable drive. Automatic checks are disabled by default.

The current Update Center records a provider-neutral configuration in SQLite and reports that no source is configured. When the base application is ready and published, the intended source is GitHub Releases.

Before enabling GitHub updates:

1. Configure the repository owner and name.
2. Define a signed release manifest containing version, platform, architecture, size, package hash, and signature.
3. Pin the public verification key in the application.
4. Download packages into `Updates/`.
5. Verify the manifest signature and package checksum before extraction.
6. Stage the new version beside the current version.
7. Exit the main application and let a tiny portable launcher perform the swap.
8. Run a health check and roll back on failure.

The application must never execute an unsigned download or update host-installed software.
