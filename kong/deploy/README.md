# Deploying to the shared EC2 host

The Aforo services already run on this box, behind nginx, with their **own**
Kong on 8000/8001. Everything here is additive: a second Kong on different
ports, its own compose project, its own network. Nothing in `/opt/aforo` is
touched.

The one shared file that must change is nginx's config, and only by adding a
new vhost. `nginx -t` before every reload — a bad config takes down the live
Aforo services along with this one.

## Order matters

Steps 1–3 are safe and reversible. Step 4 edits shared nginx. Step 5 is the
first moment anything is publicly reachable.

### 1. DNS

Create an **explicit** A record in Route 53:

```
protean-gw.aforo.ai   A   100.27.159.112
```

`*.aforo.ai` is a wildcard pointing at CloudFront. An explicit record wins over
a wildcard, so this overrides it. Without this record the hostname resolves to
CloudFront and certbot's challenge never reaches the box.

Confirm before continuing — DNS must be correct *before* certbot runs, or the
challenge fails and Let's Encrypt rate-limits repeated failures:

```sh
dig +short protean-gw.aforo.ai      # expect 100.27.159.112, not a cloudfront name
```

### 2. Configure and start the containers

```sh
cd protean/kong
cp .env.example .env      # fill in the three credentials
```

Then add the port overrides to `.env` — 8000/8001 are taken by the Aforo Kong:

```sh
echo 'KONG_PROXY_PORT=8010' >> .env
echo 'KONG_ADMIN_PORT=8011' >> .env
```

```sh
./render-config.sh
docker compose up -d --build
```

### 3. Verify locally on the box, before exposing anything

```sh
curl -s localhost:8011/ | grep -o aforo-metering        # plugin loaded
curl -s -o /dev/null -w '%{http_code}\n' localhost:8010/ekyc/v1/otp   # 401, no key

curl -s -X POST localhost:8010/ekyc/v1/otp \
  -H "X-API-Key: $(grep ICICI_API_KEY .env | cut -d= -f2)" \
  -H 'Content-Type: application/json' \
  -d '{"aadhaar":"999000100009","consent":"Y"}'          # expect 202 + txnId
```

Confirm the ports are on loopback only — the admin API must not be public:

```sh
sudo ss -tlnp | grep -E ':(8010|8011)\s'    # both should show 127.0.0.1, never 0.0.0.0
```

If either says `0.0.0.0`, stop and fix it before step 5. An exposed Kong admin
API lets anyone create a consumer and bill usage to someone else.

### 4. nginx vhost (HTTP only for now)

```sh
sudo cp nginx-protean-gw.conf /etc/nginx/sites-available/protean-gw
sudo ln -s /etc/nginx/sites-available/protean-gw /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

If `nginx -t` fails, do **not** reload. Fix or `rm` the symlink first.

### 5. TLS

```sh
sudo certbot --nginx -d protean-gw.aforo.ai
```

Certbot adds the 443 server block and the redirect itself. That is why step 4
ships HTTP only: a `listen 443` block referencing certificates that do not exist
yet fails `nginx -t`.

Then, from anywhere:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://protean-gw.aforo.ai/ekyc/v1/otp   # 401
```

### 6. Point the console at it

In the `icici` repo, on branch `public-gateway-apikey`:

```sh
PROTEAN_GATEWAY_URL=https://protean-gw.aforo.ai \
ICICI_API_KEY=sk_live_... \
ICICI_CUSTOMER_ID=... \
ICICI_KEY_ID=key-icici-001 \
node scripts/generate-session.js
```

`session.json` is gitignored, so on Vercel this has to be generated at build
time or committed as an environment-specific artifact — decide which before
deploying the console.

## Rollback

```sh
sudo rm /etc/nginx/sites-enabled/protean-gw
sudo nginx -t && sudo systemctl reload nginx
cd protean/kong && docker compose down
```

Nothing else on the host is modified, so this restores the previous state
exactly.
