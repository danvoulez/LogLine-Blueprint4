const { blake3 } = require('@noble/hashes/blake3');
let ed = null;

// Load ed25519 dynamically (ESM)
async function getEd() {
  if (!ed) ed = await import('@noble/ed25519');
  return ed;
}

function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(v => stableStringify(v)).join(',') + ']';
  const keys = Object.keys(obj).sort();
  const parts = keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k]));
  return '{' + parts.join(',') + '}';
}

// Compute BLAKE3 hash of a span (deterministic)
function hashSpan(span) {
  const clone = { ...span };
  delete clone.signature;
  delete clone.curr_hash;
  
  const canonical = stableStringify(clone);
  const hash = blake3(new TextEncoder().encode(canonical));
  return toHex(hash);
}

// Sign a span with Ed25519
async function signSpan(span, privateKeyHex) {
  const hash = hashSpan(span);
  span.curr_hash = hash;
  
  if (privateKeyHex) {
    const ed25519 = await getEd();
    const privateKey = fromHex(privateKeyHex);
    const publicKey = await ed25519.getPublicKey(privateKey);
    const signature = await ed25519.sign(fromHex(hash), privateKey);
    
    span.signature = toHex(signature);
    span.public_key = toHex(publicKey);
  }
  
  return span;
}

// Verify a span's signature
async function verifySpan(span) {
  if (!span.curr_hash || !span.signature || !span.public_key) {
    throw new Error('Span missing cryptographic fields');
  }
  
  const computedHash = hashSpan(span);
  if (computedHash !== span.curr_hash) {
    throw new Error(`Hash mismatch: expected ${span.curr_hash}, got ${computedHash}`);
  }
  
  const ed25519 = await getEd();
  const isValid = await ed25519.verify(
    fromHex(span.signature),
    fromHex(span.curr_hash),
    fromHex(span.public_key)
  );
  
  if (!isValid) {
    throw new Error('Invalid signature');
  }
  
  return true;
}

// AES-256-GCM encryption for memory content
const nodeCrypto = require('crypto');

async function encryptAES256GCM(plaintext, keyHex) {
  if (!keyHex) {
    throw new Error('Encryption key required');
  }
  
  const key = fromHex(keyHex);
  if (key.length !== 32) {
    throw new Error('Key must be 32 bytes (256 bits) for AES-256');
  }
  
  const iv = nodeCrypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  const tag = cipher.getAuthTag();
  
  return {
    encrypted: toHex(encrypted),
    iv: toHex(iv),
    tag: toHex(tag)
  };
}

async function decryptAES256GCM(encryptedHex, ivHex, tagHex, keyHex) {
  if (!keyHex) {
    throw new Error('Decryption key required');
  }
  
  const key = fromHex(keyHex);
  const iv = fromHex(ivHex);
  const tag = fromHex(tagHex);
  const encrypted = fromHex(encryptedHex);
  
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return decrypted.toString('utf8');
}

module.exports = {
  toHex,
  fromHex,
  stableStringify,
  hashSpan,
  signSpan,
  verifySpan,
  encryptAES256GCM,
  decryptAES256GCM
};
