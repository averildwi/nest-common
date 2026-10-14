import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';

// promisify cannot pick the (password, salt, keylen) overload of scrypt by itself.
const scryptAsync: (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer> = promisify(scrypt);

const KEY_LENGTH = 64;

/**
 * Password and OTP hashing with scrypt. Async on purpose: scryptSync blocks
 * the event loop for every login. Stored format is `salt:hash` (hex).
 */
@Injectable()
export class HashingService {
  async hash(plainText: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = await scryptAsync(plainText, salt, KEY_LENGTH);
    return `${salt}:${derivedKey.toString('hex')}`;
  }

  async verify(plainText: string, storedHash: string): Promise<boolean> {
    const [salt, storedKey] = storedHash.split(':');
    if (!salt || !storedKey) return false;

    // timingSafeEqual throws on a length mismatch, so reject malformed hashes first.
    const storedBuffer = Buffer.from(storedKey, 'hex');
    if (storedBuffer.length !== KEY_LENGTH) return false;

    const derivedKey = await scryptAsync(plainText, salt, KEY_LENGTH);
    return timingSafeEqual(derivedKey, storedBuffer);
  }
}
