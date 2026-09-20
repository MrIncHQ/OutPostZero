import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function browserProfileId(identity: string): string {
  if (!identity.trim()) throw new Error('Browser profile identity is missing.');
  return crypto.createHash('sha256').update(identity).digest('hex');
}

// Chromium encrypts its Windows profile with DPAPI. Never reuse that profile
// across Windows installations or accounts, or migrate the old shared profile.
export function currentBrowserProfileId(): string {
  if (process.platform !== 'win32') {
    return browserProfileId(JSON.stringify([os.hostname(), os.userInfo().username, os.homedir()]));
  }
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const identity = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; $machine = (Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid; $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if (-not $machine -or -not $sid) { throw 'Windows identity unavailable' }; Write-Output ($machine + ':' + $sid)",
  ], { encoding: 'utf8', windowsHide: true, timeout: 10_000 }).trim();
  return browserProfileId(identity);
}
