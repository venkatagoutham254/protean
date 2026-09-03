/*
 * Protean identity and trust APIs.
 *
 * Aadhaar eKYC, PAN verification, eSign and DigiLocker, behind one service.
 *
 * There is no metering, rate limiting or token parsing in this codebase, and
 * that is deliberate. Those concerns live at the gateway, which authenticates
 * the partner, meters the call and forwards the verified identity as headers.
 * Keeping them out here means a new endpoint is billable the moment it is
 * routed, with no billing code to write and none to forget.
 */
const express = require('express');
const path = require('path');
const swaggerUiDist = require('swagger-ui-dist');
const { identity, requirePartner } = require('./middleware/identity');
const { requestId, fail } = require('./middleware/request');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(requestId);
app.use(identity);

/*
 * Developer documentation.
 *
 * Served from the API itself rather than a separate docs site so the reference
 * cannot drift from the deployment: the spec a partner reads is the one shipped
 * beside the code that answers them.
 *
 * Outside partner authentication on purpose — a partner has to read the
 * documentation to work out how to authenticate, so putting it behind
 * authentication is a loop with no entrance.
 */
app.get('/openapi.yaml', (_req, res) => {
  res.type('text/yaml').sendFile(path.join(__dirname, 'openapi.yaml'));
});

app.get('/docs', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Protean API reference</title>
<link rel="stylesheet" href="/docs/assets/swagger-ui.css">
<style>
  body{margin:0}
  .topbar{display:none}
  .swagger-ui .info{margin:28px 0}
  .swagger-ui .info .title{font-size:34px}
  .swagger-ui .scheme-container{box-shadow:none;border-bottom:1px solid #e3e7ec;background:#fafbfc}
</style>
</head>
<body>
<div id="ui"></div>
<script src="/docs/assets/swagger-ui-bundle.js"></script>
<script src="/docs/assets/swagger-ui-standalone-preset.js"></script>
<script>
window.ui = SwaggerUIBundle({
  url: '/openapi.yaml',
  dom_id: '#ui',
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
  layout: 'StandaloneLayout',
  docExpansion: 'list',
  defaultModelsExpandDepth: 0,
  tryItOutEnabled: true,
  persistAuthorization: true,
  requestInterceptor: (req) => {
    // Try-it-out against the service directly needs the identity the gateway
    // would normally supply, otherwise every call comes back 401 and reads as a
    // broken example rather than a missing header.
    req.headers['X-Customer-Id'] = req.headers['X-Customer-Id'] || 'partner-sandbox';
    req.headers['X-Tenant-Id']   = req.headers['X-Tenant-Id']   || 'protean';
    req.headers['X-Key-Id']      = req.headers['X-Key-Id']      || 'sandbox-key';
    return req;
  },
});
</script>
</body>
</html>`);
});

app.use('/docs/assets', express.static(swaggerUiDist.getAbsoluteFSPath()));

// Liveness and readiness sit outside partner auth and outside metering — an
// operator's health probe is not a partner's billable call.
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'protean-api-platform' }));
app.get('/ready', (_req, res) => res.json({ status: 'ready' }));

app.get('/', (req, res) => {
  res.json({
    service: 'Protean identity and trust APIs',
    environment: req.partner.environment,
    products: [
      { name: 'Aadhaar eKYC', basePath: '/ekyc/v1' },
      { name: 'PAN Verification', basePath: '/pan/v1' },
      { name: 'Aadhaar eSign', basePath: '/esign/v1' },
      { name: 'DigiLocker', basePath: '/digilocker/v1' },
    ],
    documentation: '/docs',
  });
});

app.use('/ekyc/v1', requirePartner, require('./routes/ekyc'));
app.use('/pan/v1', requirePartner, require('./routes/pan'));
app.use('/esign/v1', requirePartner, require('./routes/esign'));
app.use('/digilocker/v1', requirePartner, require('./routes/digilocker'));

app.use((req, res) => fail(res, 404, 'PTN-404-000',
  `No route matches ${req.method} ${req.path}.`,
  'Check the endpoint against the API reference at https://developer.protean.example/docs.'));

// Malformed JSON arrives here as a SyntaxError. Left unhandled it becomes a 500,
// which tells a partner their request failed on our side when in fact their body
// did not parse — the single most common integration error, and the one worth
// naming precisely.
app.use((err, req, res, _next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return fail(res, 400, 'PTN-400-000',
      'The request body is not valid JSON.',
      'Check for a trailing comma or an unquoted key, and set Content-Type: application/json.');
  }
  console.error(`[protean] unhandled error on ${req.method} ${req.path}:`, err);
  return fail(res, 500, 'PTN-500-000',
    'The request could not be completed.',
    'Retry shortly. If it persists, contact support with the requestId below.');
});

const PORT = process.env.PORT || 9200;
app.listen(PORT, () => console.log(`[protean] identity and trust APIs listening on :${PORT}`));

module.exports = app;
