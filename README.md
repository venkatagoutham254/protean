# Protean identity and trust APIs

Four products behind one service: Aadhaar eKYC, PAN Verification, Aadhaar eSign
and DigiLocker. Partners integrate once and consume whichever they are entitled
to.

## Products and endpoints

| Product | Endpoint | What it does |
|---|---|---|
| Aadhaar eKYC | `POST /ekyc/v1/otp` | Sends an OTP to the resident's registered mobile |
| | `POST /ekyc/v1/verify` | Exchanges a valid OTP for the demographic record |
| | `POST /ekyc/v1/demographic` | Confirms supplied details against the record, field by field |
| PAN Verification | `POST /pan/v1/verify` | Confirms a PAN exists and returns status and registered name |
| | `POST /pan/v1/link-status` | Reports whether a PAN and Aadhaar are seeded together |
| Aadhaar eSign | `POST /esign/v1/initiate` | Opens a signature ceremony over a document hash |
| | `POST /esign/v1/complete` | Authenticates the signer and returns the signature |
| DigiLocker | `GET /digilocker/v1/documents` | Lists issued documents available for a resident |
| | `POST /digilocker/v1/fetch` | Retrieves one document, against per-document consent |

`GET /health` and `GET /ready` sit outside partner authentication — an
operator's probe is not a partner's call.

## Running it

```bash
npm install
npm start            # :9200
npm run smoke        # 26 checks across every endpoint and failure path
```

## How a partner is identified

This service parses no tokens. The gateway authenticates the partner and
forwards the verified identity:

| Header | Meaning |
|---|---|
| `X-Customer-Id` | the partner organisation |
| `X-Tenant-Id` | the Protean tenant |
| `X-Key-Id` | the API key used |
| `X-Scopes` | products the key is entitled to |

**These headers are trustworthy only because the gateway overwrites them on
every request and is the sole route in.** The service publishes no host port for
that reason. Expose it directly and any caller can assert any partner id, and
every usage record and audit entry becomes attributable to the wrong
organisation.

A request that arrives without a resolvable partner is refused with `401`. An
identity API that served an unidentified caller would leave no usable audit
trail, which is the one thing this category of service cannot afford.

## What is deliberately absent

No metering, no rate limiting, no token parsing, no billing code. Those live at
the gateway. A new endpoint is therefore billable the moment it is routed —
there is no usage-tracking call to add, and none to forget.

## Design decisions worth knowing

**Aadhaar numbers are checked with Verhoeff, not just length.** Transposed
digits are the commonest data-entry error and are exactly what the check digit
catches. A length check would pass them through and turn a typo into a failed
verification the partner cannot explain to their customer.

**Full Aadhaar numbers are never returned.** Only `XXXX XXXX 1234`. A partner
cannot leak what it was never given.

**Consent is explicit and per action.** eKYC, demographic match, eSign and each
DigiLocker fetch require their own flag. A resident agreeing to share a PAN card
has not agreed to share a driving licence, and a session-wide grant would
quietly collapse that distinction.

**Statuses resolve rather than 404.** A surrendered PAN and a locked Aadhaar both
return their state. A partner needs to tell "we could not find this" from "this
exists and is not usable" — only the second is a decision they can explain to
their applicant.

**Every error names its fix.** Each body carries `errorCode`, `message`,
`resolution` and `requestId`. Support conversations start with "which request?",
and an id the partner already holds answers it without either side guessing from
timestamps.

## Environment

This is the sandbox environment. Identity records are fabricated: Aadhaar
numbers come from the reserved `9999…` range and carry correct check digits, so
they exercise the same validation path as production without colliding with any
number UIDAI has issued. The OTP is fixed at `123456` so partners can automate
against it; production sends a random OTP to the registered mobile and never
returns it in the response.

### Test identities

| Aadhaar | Name | PAN | Exercises |
|---|---|---|---|
| `999000100009` | Ananya Krishnan | `AKRPK4417J` | Clean path, three documents |
| `999000200000` | R. Venkatesh | `AVNPV9021C` | Initials in name, partial documents |
| `999000300003` | Meera Sanjay Deshpande | `BMDPD3388K` | PAN not seeded with Aadhaar |
| `999000400002` | Imran Qureshi | `CIQPQ7712M` | Authentication locked by the resident |
| `999000900005` | — | — | Valid number, not enrolled |
| — | — | `DXXPS1102L` | Surrendered PAN |
