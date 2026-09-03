/*
 * Resolves the calling partner from headers the gateway sets.
 *
 * The platform does not parse tokens. Kong verifies the partner's JWT at the
 * edge and forwards the verified claims, so by the time a request arrives here
 * the identity is already established and trustworthy.
 *
 * That trust holds only because Kong overwrites these headers on every request
 * and is the sole route in. This service must never be exposed on a port a
 * client can reach directly — anyone could then assert any partner id, and
 * every usage record and audit entry downstream would be attributable to the
 * wrong organisation.
 */
function identity(req, res, next) {
  req.partner = {
    id: req.get('X-Customer-Id') || null,
    tenantId: req.get('X-Tenant-Id') || null,
    keyId: req.get('X-Key-Id') || null,
    scopes: (req.get('X-Scopes') || '').split(/[,\s]+/).filter(Boolean),
    environment: req.get('X-Environment') || 'sandbox',
  };
  next();
}

/**
 * Rejects a request whose partner could not be resolved.
 *
 * Returned as 401 rather than allowed through anonymously: an identity API that
 * served results to an unidentified caller would leave no usable audit trail,
 * which is the one thing this category of service cannot afford.
 */
function requirePartner(req, res, next) {
  if (!req.partner?.id) {
    return res.status(401).json({
      errorCode: 'PTN-401-001',
      message: 'Calling partner could not be identified.',
      resolution: 'Send the request through the Protean gateway with a valid access token.',
      requestId: req.requestId,
    });
  }
  next();
}

module.exports = { identity, requirePartner };
