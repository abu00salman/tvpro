import type { EncryptedBlob } from '@/types';
import { db } from '../storage/db';

/**
 * Credentials at rest are AES-GCM encrypted with a NON-EXTRACTABLE key that lives in
 * IndexedDB. Script on this origin can use the key, but it can never be read out,
 * exported, synced or copied out of browser storage as plain text.
 * When a backend exists, swap this module for HTTP-only sessions.
 */
const KEY_ID = 'vault:key';
let keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const existing = await db.get<CryptoKey>('kv', KEY_ID);
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await db.put('kv', key, KEY_ID);
    return key;
  })();
  return keyPromise;
}

export async function seal<T>(value: T): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, await getKey(), new TextEncoder().encode(JSON.stringify(value)),
  );
  return { iv: iv.buffer, data };
}

export async function unseal<T>(blob: EncryptedBlob): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.iv }, await getKey(), blob.data);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
