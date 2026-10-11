// Saved-app sign-in for the browser stress adapter (auth: 'saved-app').
// Exchanges the already linked native app account for a browser cookie through
// POST /api/app/session, exactly as windows/scripts/live-browser-acceptance.mjs does.
// Nothing here creates accounts, bypasses sign-in, or talks to any other origin.
//
// Credential handling rules (tested in browser-session.test.mjs):
//   - loaded only into memory, never written, logged, or passed in argv;
//   - every error thrown out of this module is a fixed message with no cause chain,
//     because loader/parse/request errors may carry the secret in their text;
//   - the token reference is cleared as soon as the exchange request is sent.
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export const ORIGIN = 'https://texttext.app';
export const AUTH_MODES = Object.freeze(['existing-profile', 'saved-app']);
export const DEFAULT_AUTH = 'existing-profile';
const MAX_TOKEN = 512;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
// Same shape the app mints (TextTextCLICore/AgentPresence.swift: `wsk_` prefix); no whitespace or control bytes.
const TOKEN = /^wsk_[A-Za-z0-9._~-]{8,}$/;

// A session error never references the thrown cause: fixed text only.
export class SessionError extends Error {
  constructor(stage, message) { super(message); this.stage = stage; }
}

export function validateAuthMode(auth) {
  if (auth === undefined) return DEFAULT_AUTH;
  if (!AUTH_MODES.includes(auth)) throw new Error(`config: auth must be one of ${AUTH_MODES.join(', ')}`);
  return auth;
}

// Profile policy: existing-profile requires a signed-in directory; saved-app may create a
// fresh, empty profile directory (non-recursive: the parent must already exist). Never deletes.
export function prepareProfile(profile, auth, fs = { existsSync, statSync, mkdirSync }) {
  const isDir = fs.existsSync(profile) && fs.statSync(profile).isDirectory();
  if (isDir) return { created: false };
  if (auth !== 'saved-app') throw new SessionError('profile', 'profile directory must already exist and be signed in');
  if (fs.existsSync(profile)) throw new SessionError('profile', 'profile path exists but is not a directory');
  const parent = dirname(profile);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new SessionError('profile', 'profile parent directory must already exist');
  fs.mkdirSync(profile, { recursive: false, mode: 0o700 });
  return { created: true };
}

function tokenOk(token) {
  return typeof token === 'string' && token.length <= MAX_TOKEN && TOKEN.test(token);
}

// Windows: the DPAPI account record, identical to the production acceptance script
// ({ WorkspaceId, Token }). The record must name the configured workspace.
export function validateWindowsAccount(account, workspaceId) {
  if (!account || typeof account !== 'object') throw new SessionError('account', 'saved account is not readable');
  if (typeof account.WorkspaceId !== 'string' || !UUID.test(account.WorkspaceId) || account.WorkspaceId !== workspaceId) {
    throw new SessionError('account', 'saved account does not match the test workspace');
  }
  if (!tokenOk(account.Token)) throw new SessionError('account', 'saved account token is not usable');
  return { token: account.Token };
}

// macOS: the CLI credential mirror written by StateStore.mirrorCredentialsForCLI
// ({ token, serverOrigin, tokenName, linkedAt }). The origin must be exactly the live
// app origin; a local or foreign origin never reaches the exchange.
export function validateMacCredentials(credentials) {
  if (!credentials || typeof credentials !== 'object') throw new SessionError('account', 'saved credentials are not readable');
  if (credentials.serverOrigin !== ORIGIN) throw new SessionError('account', 'saved credentials are not for the live app origin');
  if (!tokenOk(credentials.token)) throw new SessionError('account', 'saved credentials token is not usable');
  return { token: credentials.token };
}

export function macCredentialsPath(home = homedir()) {
  return join(home, 'Library', 'Application Support', 'TextText', 'credentials.json');
}

// Default loaders. Both return the parsed record and nothing else; failures are swallowed
// into fixed messages because exec/parse errors embed the decrypted or raw text.
const WINDOWS_SCRIPT = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $p=Join-Path $env:LOCALAPPDATA 'TextText/account.dpapi'; $v=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($p),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Text.Encoding]::UTF8.GetString($v))`;

export function loadSavedAccount(platform) {
  let text = null;
  try {
    if (platform === 'win32') {
      text = execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000, maxBuffer: 64 * 1024 });
    } else if (platform === 'darwin') {
      text = readFileSync(macCredentialsPath(), 'utf8');
    } else {
      throw new Error('unsupported');
    }
    return JSON.parse(text);
  } catch {
    throw new SessionError('account', 'saved app account could not be read');
  } finally {
    text = null;
  }
}

export function sessionRequest(workspaceId, itemId) {
  if (!UUID.test(workspaceId) || !UUID.test(itemId)) throw new SessionError('account', 'fixture ids invalid');
  const destination = `/vault/${workspaceId}?item=${itemId}`;
  return { url: `${ORIGIN}/api/app/session?next=${encodeURIComponent(destination)}`, destination };
}

// Exchange the saved account for a browser session cookie inside `context`.
// `load(platform)` and `exchange({ url, headers, maxRedirects })` are injectable for tests;
// the default exchange is context.request.post, which stores the cookie in the context jar.
export async function establishSavedAppSession({ context, platform, workspaceId, itemId, load = loadSavedAccount, exchange }) {
  const { url, destination } = sessionRequest(workspaceId, itemId);
  let raw;
  try {
    raw = load(platform);
  } catch (error) {
    // A loader error may quote the decrypted text; only this module's fixed messages pass through.
    throw error instanceof SessionError ? error : new SessionError('account', 'saved app account could not be read');
  }
  const account = platform === 'win32' ? validateWindowsAccount(raw, workspaceId) : platform === 'darwin' ? validateMacCredentials(raw) : null;
  if (!account) throw new SessionError('account', 'saved-app auth runs only on macOS or Windows');
  scrub(raw);
  const send = exchange ?? ((request) => context.request.post(request.url, { headers: request.headers, maxRedirects: request.maxRedirects }));
  let status;
  try {
    const headers = { Authorization: `Bearer ${account.token}`, 'x-texttext-app': '1' };
    account.token = null;
    const pending = send({ url, headers, maxRedirects: 0 });
    headers.Authorization = null;
    const response = await pending;
    status = typeof response?.status === 'function' ? response.status() : response?.status;
  } catch {
    throw new SessionError('sign-in', 'saved app account could not establish the browser session');
  }
  if (status !== 303) throw new SessionError('sign-in', 'saved app account could not establish the browser session');
  return { destination };
}

function scrub(record) {
  if (!record || typeof record !== 'object') return;
  for (const key of Object.keys(record)) {
    if (typeof record[key] === 'string') record[key] = '';
  }
}
