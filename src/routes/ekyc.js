const express = require('express');
const crypto = require('crypto');
const { byAadhaar } = require('../data/registry');
const { isValidAadhaar, maskAadhaar } = require('../lib/verhoeff');
const { newTxnId, fail } = require('../middleware/request');

const router = express.Router();

/*
 * OTP transactions, held in memory.
 *
 * Keyed by txnId rather than by Aadhaar number so a resident can have more than
 * one authentication in flight — a partner retrying on a slow network must not
 * invalidate the attempt their customer is already reading off their phone.
 */
const otpTxns = new Map();

const OTP_TTL_MS = 10 * 60 * 1000;   // UIDAI OTPs stand for ten minutes
const MAX_ATTEMPTS = 3;              // then the transaction is burned

function sweepExpired() {
  const now = Date.now();
  for (const [id, txn] of otpTxns) {
    if (now > txn.expiresAt) otpTxns.delete(id);
  }
}

/**
 * POST /ekyc/v1/otp
 * Sends an OTP to the mobile number registered against the Aadhaar holder.
 */
router.post('/otp', (req, res) => {
  const { aadhaar, consent } = req.body || {};

  // Consent is checked before the number is even looked at. Authentication
  // without recorded consent is not permitted under the Aadhaar Act, and a
  // partner that forgets the flag must be stopped at the first call rather
  // than discovering it in an audit.
  if (consent !== 'Y') {
    return fail(res, 400, 'PTN-400-010',
      'Resident consent was not recorded for this request.',
      'Capture explicit consent from the resident and resend with consent set to "Y".');
  }

  if (!isValidAadhaar(String(aadhaar || ''))) {
    return fail(res, 400, 'PTN-400-001',
      'The Aadhaar number is not valid.',
      'Send a 12-digit Aadhaar number. Check for transposed digits — the check digit did not match.');
  }

  const resident = byAadhaar.get(String(aadhaar));
  if (!resident) {
    // Deliberately the same shape as a locked record below, but a different
    // code: partners need to tell "not enrolled" from "refused" to route the
    // customer correctly, while neither response confirms anything about a
    // number that was never enrolled.
    return fail(res, 404, 'PTN-404-001',
      'No Aadhaar record was found for this number.',
      'Ask the resident to confirm the number, or route them to an alternative KYC method.');
  }

  if (resident.status === 'AUTH_LOCKED') {
    return fail(res, 403, 'PTN-403-002',
      'The resident has locked Aadhaar authentication on this number.',
      'The resident can unlock authentication on the UIDAI portal, or you can use an offline KYC method.');
  }

  sweepExpired();
  const txnId = newTxnId('OTP');
  otpTxns.set(txnId, {
    aadhaar: resident.aadhaar,
    // Fixed in sandbox so a partner can automate against it. The production
    // environment sends a random OTP to the registered mobile and never
    // returns it in the response.
    otp: '123456',
    attempts: 0,
    expiresAt: Date.now() + OTP_TTL_MS,
    partnerId: req.partner.id,
  });

  res.status(202).json({
    txnId,
    status: 'OTP_SENT',
    maskedMobile: `XXXXXX${resident.mobileLast4.slice(-4)}`,
    validForSeconds: OTP_TTL_MS / 1000,
    attemptsAllowed: MAX_ATTEMPTS,
    requestId: req.requestId,
  });
});

/**
 * POST /ekyc/v1/verify
 * Exchanges a valid OTP for the resident's demographic record.
 */
router.post('/verify', (req, res) => {
  const { txnId, otp } = req.body || {};

  const txn = txnId && otpTxns.get(txnId);
  if (!txn) {
    return fail(res, 404, 'PTN-404-002',
      'This transaction is not recognised or has expired.',
      'Start a new authentication with POST /ekyc/v1/otp.');
  }

  if (Date.now() > txn.expiresAt) {
    otpTxns.delete(txnId);
    return fail(res, 410, 'PTN-410-001',
      'The OTP for this transaction has expired.',
      'Start a new authentication with POST /ekyc/v1/otp.');
  }

  if (String(otp) !== txn.otp) {
    txn.attempts += 1;
    const remaining = MAX_ATTEMPTS - txn.attempts;
    if (remaining <= 0) {
      // Burn the transaction rather than let it be retried indefinitely.
      otpTxns.delete(txnId);
      return fail(res, 429, 'PTN-429-001',
        'Too many incorrect OTP attempts. This transaction has been closed.',
        'Start a new authentication with POST /ekyc/v1/otp.');
    }
    return fail(res, 401, 'PTN-401-002',
      'The OTP did not match.',
      `Ask the resident to re-enter the OTP. ${remaining} attempt(s) remain.`,
      { attemptsRemaining: remaining });
  }

  const resident = byAadhaar.get(txn.aadhaar);
  otpTxns.delete(txnId);

  res.json({
    txnId,
    status: 'VERIFIED',
    verifiedAt: new Date().toISOString(),
    // Only the last four digits are ever returned. Storing or displaying a full
    // Aadhaar number is prohibited, so the API does not hand one back at all —
    // a partner cannot leak what it was never given.
    kyc: {
      aadhaarMasked: maskAadhaar(resident.aadhaar),
      name: resident.name,
      dateOfBirth: resident.dob,
      gender: resident.gender,
      email: resident.email,
      mobileMasked: `XXXXXX${resident.mobileLast4.slice(-4)}`,
      address: resident.address,
    },
    requestId: req.requestId,
  });
});

/**
 * POST /ekyc/v1/demographic
 * Confirms whether supplied details match the Aadhaar record. Returns a yes/no
 * per field and never echoes the stored values, so a partner cannot use it to
 * enumerate a record they do not already hold.
 */
router.post('/demographic', (req, res) => {
  const { aadhaar, name, dateOfBirth, gender, consent } = req.body || {};

  if (consent !== 'Y') {
    return fail(res, 400, 'PTN-400-010',
      'Resident consent was not recorded for this request.',
      'Capture explicit consent from the resident and resend with consent set to "Y".');
  }
  if (!isValidAadhaar(String(aadhaar || ''))) {
    return fail(res, 400, 'PTN-400-001',
      'The Aadhaar number is not valid.',
      'Send a 12-digit Aadhaar number. Check for transposed digits — the check digit did not match.');
  }

  const resident = byAadhaar.get(String(aadhaar));
  if (!resident) {
    return fail(res, 404, 'PTN-404-001',
      'No Aadhaar record was found for this number.',
      'Ask the resident to confirm the number, or route them to an alternative KYC method.');
  }

  const norm = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ');
  const matches = {};
  if (name !== undefined) matches.name = norm(name) === norm(resident.name);
  if (dateOfBirth !== undefined) matches.dateOfBirth = String(dateOfBirth) === resident.dob;
  if (gender !== undefined) matches.gender = String(gender).toUpperCase() === resident.gender;

  const checked = Object.keys(matches);
  if (checked.length === 0) {
    return fail(res, 400, 'PTN-400-011',
      'No attributes were supplied to match against.',
      'Send at least one of name, dateOfBirth or gender.');
  }

  res.json({
    txnId: newTxnId('DEM'),
    status: checked.every((k) => matches[k]) ? 'MATCH' : 'MISMATCH',
    aadhaarMasked: maskAadhaar(resident.aadhaar),
    matches,
    checkedAt: new Date().toISOString(),
    requestId: req.requestId,
  });
});

module.exports = router;
