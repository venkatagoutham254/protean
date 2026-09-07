# Kong gateway + Aforo metering

Puts Kong in front of the Protean identity APIs so every call is authenticated
and metered into Aforo for billing.

## Why the plugin is baked into an image

The plugin **cannot** be installed into a running Kong container. `KONG_PLUGINS`
is an environment variable, so changing it recreates the container, which
discards whatever `luarocks make` installed in the previous one. Kong then
refuses to boot — and because it dies inside `init_by_lua`, you cannot
`docker exec` in to install it. That is a deadlock, not a flaky install.

`plugin/Dockerfile` installs the rock at build time, so the plugin is present
before Kong ever starts.

## Setup

```sh
cd kong
cp .env.example .env      # fill in all three values
docker compose up -d --build
```

Three values go in `.env` — see the comments there for what each one is and how
they fail when swapped. Nothing secret is committed: `kong.yml` refers to them
as `{vault://env/NAME}`, resolved at boot by `KONG_VAULTS=env`.

## Verify

```sh
# 1. Kong is up and the plugin loaded (empty output here means it did NOT load)
curl -s localhost:8001/plugins | grep -o aforo-metering

# 2. A call without a key is rejected
curl -s -o /dev/null -w '%{http_code}\n' localhost:8000/pan/v1/verify   # 401

# 3. A call with ICICI's key succeeds
curl -s -X POST localhost:8000/ekyc/v1/otp \
  -H "X-API-Key: $ICICI_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"aadhaar":"999999990019"}'

# 4. Within ~5s the event flushes. Confirm in the proxy log:
docker compose logs kong | grep aforo-metering
#   expect: Flushed 1 events to Aforo (status=202)
```

If step 4 shows `accepted:0, failed:1`, read the message — the ingestor says
exactly what is wrong (unknown metric, clock skew, bad customer).

## Metric mapping

`kong.yml` maps eight endpoints onto six metrics:

| Endpoint | Method | Metric |
|---|---|---|
| `/ekyc/v1/otp` | POST | `ekyc_otp_sent` |
| `/ekyc/v1/verify` | POST | `ekyc_verifications` |
| `/ekyc/v1/demographic` | POST | `demographic_matches` |
| `/pan/v1/link-status` | GET | `pan_link_checks` |
| `/esign/v1/initiate` | POST | `esign_requests` |
| `/esign/v1/complete` | POST | `esign_requests` |
| `/digilocker/v1/documents` | GET | `documents_fetched` |
| `/digilocker/v1/fetch` | POST | `documents_fetched` |

`path_pattern` is a **Lua pattern**, not a glob. Two rules follow from that:

- `^` anchors the match. Without it a rule can match a longer, unrelated path.
- Hyphens must be escaped as `%-`. Unescaped, `link-status` parses as `lin`
  followed by `k-` (lazy zero-or-more `k`) followed by `status` — so it matches
  `linkstatus` and never `link-status`. The failure is silent: the request is
  proxied normally and simply metered under the wrong metric or not at all.

There is deliberately **no** `default_metric`. An unmapped path is dropped rather
than billed under a catch-all name the Aforo catalog does not recognise.

`POST /pan/v1/verify` is intentionally absent from the table: it is proxied like
any other route but is **not metered**, so those calls are never billed. Add a
mapping once its catalog metric is in use.

## Adding an endpoint

1. Register the metric in Aforo (catalog) first.
2. Add a `metric_mappings` entry — specific patterns before general ones.
3. `docker compose restart kong`, then re-run the verification above.
