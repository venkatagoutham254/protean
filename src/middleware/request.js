const crypto = require('crypto');

/**
 * Assigns a request id and echoes it on the response.
 *
 * Every error body carries the same id. Partner support conversations start
 * with "which request?", and an id the partner already has in their own logs
 * answers it without either side guessing from timestamps.
 */
function requestId(req, res, next) {
  req.requestId = req.get('X-Request-Id') || `req_${crypto.randomBytes(9).toString('hex')}`;
  res.set('X-Request-Id', req.requestId);
  next();
}

/** Transaction id in the shape partners reconcile against. */
function newTxnId(prefix) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${stamp}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

/** Consistent error shape across every endpoint. */
function fail(res, status, errorCode, message, resolution, extra = {}) {
  return res.status(status).json({
    errorCode,
    message,
    resolution,
    requestId: res.req.requestId,
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

module.exports = { requestId, newTxnId, fail };
