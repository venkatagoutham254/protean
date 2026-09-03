const express = require('express');
const { PANS, byAadhaar } = require('../data/registry');
const { isWellFormedPan, holderTypeOf } = require('../lib/pan');
const { isValidAadhaar } = require('../lib/verhoeff');
const { newTxnId, fail } = require('../middleware/request');

const router = express.Router();

/**
 * POST /pan/v1/verify
 * Confirms a PAN exists and returns its status and registered name.
 */
router.post('/verify', (req, res) => {
  const raw = String(req.body?.pan || '').toUpperCase().trim();

  if (!isWellFormedPan(raw)) {
    return fail(res, 400, 'PTN-400-020',
      'The PAN is not in a valid format.',
      'A PAN is five letters, four digits and one letter, for example ABCDE1234F.');
  }

  const record = PANS[raw];
  if (!record) {
    return fail(res, 404, 'PTN-404-020',
      'No PAN record was found.',
      'Ask the applicant to confirm the PAN exactly as printed on the card.');
  }

  res.json({
    txnId: newTxnId('PAN'),
    pan: raw,
    // SURRENDERED and similar states resolve rather than 404: a partner needs
    // to tell "we could not find this" from "this exists and is not usable",
    // because only the second is a decision they can explain to the applicant.
    status: record.status,
    registeredName: record.name,
    holderType: holderTypeOf(raw),
    aadhaarSeeded: record.aadhaarSeeded,
    lastUpdated: record.lastUpdated,
    requestId: req.requestId,
  });
});

/**
 * POST /pan/v1/link-status
 * Reports whether a PAN and Aadhaar are seeded against each other.
 */
router.post('/link-status', (req, res) => {
  const pan = String(req.body?.pan || '').toUpperCase().trim();
  const aadhaar = String(req.body?.aadhaar || '');

  if (!isWellFormedPan(pan)) {
    return fail(res, 400, 'PTN-400-020',
      'The PAN is not in a valid format.',
      'A PAN is five letters, four digits and one letter, for example ABCDE1234F.');
  }
  if (!isValidAadhaar(aadhaar)) {
    return fail(res, 400, 'PTN-400-001',
      'The Aadhaar number is not valid.',
      'Send a 12-digit Aadhaar number. Check for transposed digits — the check digit did not match.');
  }

  const record = PANS[pan];
  const resident = byAadhaar.get(aadhaar);
  if (!record || !resident) {
    return fail(res, 404, 'PTN-404-021',
      'The PAN or the Aadhaar number could not be found.',
      'Confirm both identifiers with the applicant before retrying.');
  }

  const linked = record.aadhaarSeeded && resident.pan === pan;

  res.json({
    txnId: newTxnId('LNK'),
    pan,
    linked,
    // Naming the reason matters: "not linked" sends the applicant to the tax
    // portal, whereas "linked to a different PAN" means they gave the wrong one
    // and the partner should ask again.
    reason: linked
      ? 'PAN and Aadhaar are seeded against each other.'
      : record.aadhaarSeeded
        ? 'This Aadhaar is seeded against a different PAN.'
        : 'This PAN has not been seeded with any Aadhaar.',
    checkedAt: new Date().toISOString(),
    requestId: req.requestId,
  });
});

module.exports = router;
