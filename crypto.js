/*
 * crypto.js — passphrase encryption for anything that leaves the phone.
 *
 * A GPS track of your rides is sensitive in a way that a spreadsheet isn't: it
 * shows where you were, when, and — because rides usually start from home or a
 * regular car park — where you live. A backup file that syncs to a cloud drive
 * or sits in a repo should not be readable by whoever ends up holding it.
 *
 * AES-256-GCM, key derived with PBKDF2-SHA256. GCM is authenticated, so a
 * tampered file fails to decrypt rather than silently returning wrong data.
 *
 * WebCrypto requires a secure context, which the app already needs for the
 * accelerometer, so there's no extra constraint here.
 */

const KDF_ITERATIONS = 210000;   // ~1-2 s on an iPhone 6s. Slow is the point.
const SALT_BYTES = 16;
const IV_BYTES = 12;

function b64(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function unb64(s) {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptJSON(obj, passphrase) {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  return {
    format: 'mtbbump-encrypted',
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS },
    cipher: 'AES-GCM',
    salt: b64(salt),
    iv: b64(iv),
    data: b64(ct),
  };
}

async function decryptJSON(envelope, passphrase) {
  if (!envelope || envelope.format !== 'mtbbump-encrypted') {
    throw new Error('Not an encrypted MTB Bump backup.');
  }
  const salt = unb64(envelope.salt);
  const iv = unb64(envelope.iv);
  const iterations = (envelope.kdf && envelope.kdf.iterations) || KDF_ITERATIONS;
  const key = await deriveKey(passphrase, salt, iterations);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, key, unb64(envelope.data)
    );
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    // GCM authentication failure. Almost always the wrong passphrase; could
    // also be a corrupted or altered file. There's no way to tell them apart,
    // and that's by design.
    throw new Error('Could not decrypt — wrong passphrase, or the file was altered.');
  }
}

window.Crypto = { encryptJSON, decryptJSON, KDF_ITERATIONS };
