/*
 * Verhoeff checksum — the check-digit scheme the Aadhaar numbering system uses.
 *
 * Implemented properly rather than stubbed so the platform rejects a mistyped
 * number the same way the production UIDAI stack does. A transposed pair of
 * digits is the most common data-entry error a partner makes, and Verhoeff is
 * chosen precisely because it catches those; a length check alone would pass
 * them through and turn a typo into a failed verification the partner cannot
 * explain to their customer.
 */
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** True when the 12-digit string carries a valid Verhoeff check digit. */
function isValidAadhaar(value) {
  if (typeof value !== 'string' || !/^\d{12}$/.test(value)) return false;
  // Aadhaar numbers never begin 0 or 1 — that range is reserved.
  if (value[0] === '0' || value[0] === '1') return false;

  let c = 0;
  const digits = value.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) {
    c = D[c][P[i % 8][digits[i]]];
  }
  return c === 0;
}

/** Appends the correct check digit to an 11-digit body. Used to build fixtures. */
function withCheckDigit(elevenDigits) {
  const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];
  let c = 0;
  const digits = elevenDigits.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) {
    c = D[c][P[(i + 1) % 8][digits[i]]];
  }
  return elevenDigits + String(INV[c]);
}

/** UIDAI presentation rule: only the last four digits may be displayed. */
function maskAadhaar(value) {
  return `XXXX XXXX ${value.slice(-4)}`;
}

module.exports = { isValidAadhaar, withCheckDigit, maskAadhaar };
