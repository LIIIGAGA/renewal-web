import type { GitHubConnection } from './github-ledger';
export const DEVICE_KEY = 'renewal-github-device-v1';
export function readDeviceConnection(): GitHubConnection | null {
  const raw = localStorage.getItem(DEVICE_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || typeof saved.owner !== 'string' || typeof saved.repo !== 'string' || typeof saved.token !== 'string' || !saved.token.trim()) return null;
    return {owner:saved.owner,repo:saved.repo,token:saved.token};
  } catch { return null; }
}
export function saveDeviceConnection(connection: GitHubConnection) { localStorage.setItem(DEVICE_KEY, JSON.stringify({version:1,...connection})); }
export function clearDeviceConnection() { localStorage.removeItem(DEVICE_KEY); }
