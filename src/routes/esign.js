const express = require('express');
const crypto = require('crypto');
const { byAadhaar } = require('../data/registry');
const { isValidAadhaar, maskAadhaar } = require('../lib/verhoeff');
const { newTxnId, fail } = require('../middleware/request');

const router = express.Router();

const signCeremonies = new Map();
const CEREMONY_TTL_MS = 15 * 60 * 1000;

/**
 * POST /esign/v1/initiate
 * Opens a signature ceremony over a document hash.
 *
 * The document itself is never uploaded — only its SHA-256. The signer holds
 * the document, the platform signs the hash, and a document that never crosses
 * the wire cannot be retained, subpoenaed from here, or leaked from here.
 */
router.post('/initiate', (req, res) => {
  const { aadhaar, documentHash, documentName, signerConsent } = req.body || {};

  if (signerConsent !== 'Y') {
    return fail(res, 400, 'PTN-400-030',
      'Signer consent was not recorded for this ceremony.',
      'Capture explicit consent from the signer and resend with signerConsent set to "Y".');
  }
  if (!isValidAadhaar(String(aadhaar || ''))) {
    return fail(res, 400, 'PTN-400-001',
      'The Aadhaar number is not valid.',
      'Send a 12-digit Aadhaar number. Check for transposed digits — the check digit did not match.');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(documentHash || ''))) {
    return fail(res, 400, 'PTN-400-031',
      'The document hash is not a SHA-256 digest.',
      'Send the lowercase hex SHA-256 of the exact bytes to be signed (64 characters).');
  }

  const resident = byAadhaar.get(String(aadhaar));
  if (!resident) {
    return fail(res, 404, 'PTN-404-001',
      'No Aadhaar record was found for this number.',
      'Ask the signer to confirm the number, or use an alternative signing method.');
  }
  if (resident.status === 'AUTH_LOCKED') {
    return fail(res, 403, 'PTN-403-002',
      'The signer has locked Aadhaar authentication on this number.',
      'The signer can unlock authentication on the UIDAI portal, or you can use a token-based signature.');
  }

  const txnId = newTxnId('ESN');
  signCeremonies.set(txnId, {
    aadhaar: resident.aadhaar,
    documentHash: String(documentHash).toLowerCase(),
    documentName: documentName || 'document.pdf',
    otp: '123456',
    expiresAt: Date.now() + CEREMONY_TTL_MS,
  });

  res.status(202).json({
    txnId,
    status: 'AWAITING_SIGNER',
    signerMobileMasked: `XXXXXX${resident.mobileLast4.slice(-4)}`,
    documentName: documentName || 'document.pdf',
    validForSeconds: CEREMONY_TTL_MS / 1000,
    requestId: req.requestId,
  });
});

/**
 * POST /esign/v1/complete
 * Authenticates the signer and returns the signature over the document hash.
 */
router.post('/complete', (req, res) => {
  const { txnId, otp } = req.body || {};
  const ceremony = txnId && signCeremonies.get(txnId);

  if (!ceremony) {
    return fail(res, 404, 'PTN-404-030',
      'This signature ceremony is not recognised or has expired.',
      'Start a new ceremony with POST /esign/v1/initiate.');
  }
  if (Date.now() > ceremony.expiresAt) {
    signCeremonies.delete(txnId);
    return fail(res, 410, 'PTN-410-002',
      'This signature ceremony has expired.',
      'Start a new ceremony with POST /esign/v1/initiate.');
  }
  if (String(otp) !== ceremony.otp) {
    return fail(res, 401, 'PTN-401-002',
      'The OTP did not match.',
      'Ask the signer to re-enter the OTP sent to their registered mobile.');
  }

  const resident = byAadhaar.get(ceremony.aadhaar);
  signCeremonies.delete(txnId);

  const signedAt = new Date().toISOString();
  // Deterministic over hash + signer + time, so the same inputs reproduce the
  // same signature and a partner can assert equality in their own tests.
  const signature = crypto
    .createHash('sha256')
    .update(`${ceremony.documentHash}|${resident.aadhaar}|${signedAt}`)
    .digest('base64');

  res.json({
    txnId,
    status: 'SIGNED',
    signedAt,
    documentName: ceremony.documentName,
    documentHash: ceremony.documentHash,
    signature,
    signatureAlgorithm: 'SHA256withRSA',
    signer: {
      name: resident.name,
      aadhaarMasked: maskAadhaar(resident.aadhaar),
    },
    certificate: {
      subject: `CN=${resident.name}, O=Aadhaar eSign, C=IN`,
      issuer: 'CN=Protean eSign CA, O=Protean, C=IN',
      // eSign certificates are issued for the ceremony and expire with it.
      validFrom: signedAt,
      validTo: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      serialNumber: crypto.randomBytes(8).toString('hex').toUpperCase(),
    },
    requestId: req.requestId,
  });
});

module.exports = router;
