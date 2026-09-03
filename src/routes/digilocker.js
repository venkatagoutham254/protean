const express = require('express');
const { DOCUMENTS, byAadhaar } = require('../data/registry');
const { isValidAadhaar, maskAadhaar } = require('../lib/verhoeff');
const { newTxnId, fail } = require('../middleware/request');

const router = express.Router();

/**
 * GET /digilocker/v1/documents?aadhaar=...
 * Lists the issued documents available for a resident.
 *
 * Returns metadata only. Listing is cheap and safe; fetching the contents is
 * the sensitive, billable act, so the two are separate calls.
 */
router.get('/documents', (req, res) => {
  const aadhaar = String(req.query.aadhaar || '');

  if (!isValidAadhaar(aadhaar)) {
    return fail(res, 400, 'PTN-400-001',
      'The Aadhaar number is not valid.',
      'Send a 12-digit Aadhaar number. Check for transposed digits — the check digit did not match.');
  }

  const resident = byAadhaar.get(aadhaar);
  if (!resident) {
    return fail(res, 404, 'PTN-404-001',
      'No Aadhaar record was found for this number.',
      'Ask the resident to confirm the number.');
  }

  const docs = DOCUMENTS[aadhaar] || [];
  res.json({
    txnId: newTxnId('DLK'),
    aadhaarMasked: maskAadhaar(aadhaar),
    holderName: resident.name,
    documentCount: docs.length,
    documents: docs.map((d) => ({
      docId: d.docId,
      docType: d.docType,
      issuer: d.issuer,
      issuedOn: d.issuedOn,
      mime: d.mime,
      sizeBytes: d.sizeBytes,
    })),
    requestId: req.requestId,
  });
});

/**
 * POST /digilocker/v1/fetch
 * Retrieves one issued document.
 *
 * Consent is per document, not per session. A resident agreeing to share a PAN
 * card has not agreed to share a driving licence, and a single session-wide
 * grant would quietly collapse that distinction.
 */
router.post('/fetch', (req, res) => {
  const { aadhaar, docId, consent } = req.body || {};

  if (consent !== 'Y') {
    return fail(res, 400, 'PTN-400-040',
      'Resident consent was not recorded for this document.',
      'Capture consent for this specific document and resend with consent set to "Y".');
  }
  if (!isValidAadhaar(String(aadhaar || ''))) {
    return fail(res, 400, 'PTN-400-001',
      'The Aadhaar number is not valid.',
      'Send a 12-digit Aadhaar number. Check for transposed digits — the check digit did not match.');
  }

  const docs = DOCUMENTS[String(aadhaar)] || [];
  const doc = docs.find((d) => d.docId === docId);
  if (!doc) {
    return fail(res, 404, 'PTN-404-040',
      'This document is not available for the resident.',
      'List available documents with GET /digilocker/v1/documents before fetching.');
  }

  const resident = byAadhaar.get(String(aadhaar));
  res.json({
    txnId: newTxnId('DLF'),
    status: 'FETCHED',
    fetchedAt: new Date().toISOString(),
    document: {
      docId: doc.docId,
      docType: doc.docType,
      issuer: doc.issuer,
      issuedOn: doc.issuedOn,
      mime: doc.mime,
      sizeBytes: doc.sizeBytes,
      holderName: resident.name,
      aadhaarMasked: maskAadhaar(String(aadhaar)),
      // Short-lived and single-use. A URL that outlived the request would turn
      // a consented, audited fetch into an unauthenticated document endpoint.
      contentUrl: `https://content.protean.example/${doc.docId}?expires=${Date.now() + 300000}`,
      contentExpiresInSeconds: 300,
    },
    requestId: req.requestId,
  });
});

module.exports = router;
