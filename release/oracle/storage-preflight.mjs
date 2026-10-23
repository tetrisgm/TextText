import { lstatSync, readFileSync, statfsSync } from 'node:fs';
import { parseEnv } from 'node:util';

export function requireBackupSpace(environment, availableBytes) {
  const budget = Number(environment.TEXTTEXT_BACKUP_MAX_BYTES || 5 * 1024 ** 3);
  const floor = Number(environment.TEXTTEXT_STORAGE_MIN_FREE_BYTES || 2 * 1024 ** 3);
  if (!Number.isSafeInteger(budget) || budget < 1024 || !Number.isSafeInteger(floor) || floor < 0) {
    throw new Error('Invalid backup storage budget or free-space floor.');
  }
  const required = BigInt(budget) + BigInt(floor);
  if (availableBytes < required) {
    throw new Error(`Deploy refused before build/transfer: Oracle has ${availableBytes} bytes free; backup budget plus floor requires ${required}. Existing files were preserved.`);
  }
  return required;
}

// Piped to the existing Oracle SSH session; no secrets cross the connection.
if (process.argv.includes('--check')) {
  const file = '/etc/texttext/backup.env';
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o777) !== 0o600) {
    throw new Error('Backup environment must be a root-owned regular file with mode 0600.');
  }
  const environment = parseEnv(readFileSync(file, 'utf8'));
  const directory = environment.TEXTTEXT_BACKUP_DIR || '/home/ubuntu/texttext/backups';
  const filesystem = statfsSync(directory, { bigint: true });
  const available = filesystem.bavail * filesystem.bsize;
  const required = requireBackupSpace(environment, available);
  console.log(`Oracle backup storage preflight passed: ${available} bytes available, ${required} required.`);
}
