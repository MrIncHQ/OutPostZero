# Security Model

- Electron context isolation and renderer sandboxing are enabled.
- Node integration is disabled in the renderer.
- IPC exposes only explicitly defined operations.
- Navigation and new windows are denied outside the development origin.
- A content security policy restricts executable content and network connections.
- Portable paths reject absolute paths and traversal outside the marked root.
- Outpost Zero creates no services, scheduled tasks, firewall rules, registry configuration, or permanent environment changes.

Imported content, modules, cryptographic identity, and local networking are not implemented yet and must receive dedicated threat modeling before release.
