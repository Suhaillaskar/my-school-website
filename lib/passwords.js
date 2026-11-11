const { promisify } = require('node:util');
const { randomBytes, scrypt: scryptCallback, timingSafeEqual } = require('node:crypto');

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
    const derivedKey = await scrypt(password, salt, KEY_LENGTH);
    return { salt, hash: derivedKey.toString('hex') };
}

async function verifyPassword(password, salt, expectedHash) {
    const actualHash = await scrypt(password, salt, KEY_LENGTH);
    const expected = Buffer.from(expectedHash, 'hex');
    return expected.length === actualHash.length && timingSafeEqual(actualHash, expected);
}

function isValidPassword(password) {
    return typeof password === 'string' && password.length >= 12 && password.length <= 128;
}

module.exports = { hashPassword, verifyPassword, isValidPassword };
