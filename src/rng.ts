import { createHmac, createHash } from 'node:crypto';

/**
 * Commitment hash: activeServerSeedHash = SHA-256( utf8_bytes( serverSeed_hex_string ) ).
 * Stake convention — hashes the UTF-8 encoding of the hex STRING, not the 16 raw bytes.
 */
export function commitHash(serverSeedHexString: string): string {
  return createHash('sha256').update(serverSeedHexString, 'utf8').digest('hex');
}

/** Raw SHA-256 of a buffer — used for the dataset integrity guard. */
export function sha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function getProvablyFairHmacSalt(
  clientSeed: string,
  nonce: number,
  cursor: number
): string {
  return `${clientSeed}:${nonce}:${cursor}`;
}

export function generateProvablyFairNumber(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  cursor: number,
  range: number
): number {
  const key = Buffer.from(serverSeed, 'hex');
  const digest = createHmac('sha256', key)
    .update(getProvablyFairHmacSalt(clientSeed, nonce, cursor))
    .digest();

  const maxFair = Math.floor(0x1_0000_0000 / range) * range;
  for (let offset = 0; offset + 4 <= digest.length; offset += 4) {
    const chunk = digest.readUInt32BE(offset);
    if (chunk < maxFair) return chunk % range;
  }

  return generateProvablyFairNumber(serverSeed, clientSeed, nonce, cursor + 1_000_000, range);
}

export function revealPlinko(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  numberOfRows: number
): { path: string; winningSlot: number } {
  let path = '';
  for (let i = 0; i < numberOfRows; i++) {
    const bit = generateProvablyFairNumber(serverSeed, clientSeed, nonce, i + 1, 2);
    path += `${bit}`;
  }
  const winningSlot = path.split('').filter((c) => c === '1').length;
  return { path, winningSlot };
}
