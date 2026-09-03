#!/usr/bin/env bash
# Exercises every endpoint, including the failure paths partners hit most.
# Identity headers are set by hand here; in a routed environment the gateway
# supplies them and this script would omit them entirely.
set -uo pipefail
BASE="${BASE:-http://localhost:9200}"
H=(-H "Content-Type: application/json" -H "X-Customer-Id: acme-lending" -H "X-Tenant-Id: protean" -H "X-Key-Id: key-001")
AAD="${AAD:-999000100009}"
LOCKED="999000400002"
pass=0; fail=0
chk(){ local label="$1" want="$2"; shift 2
  got=$(curl -s -o /tmp/pt.out -w '%{http_code}' "$@")
  if [ "$got" = "$want" ]; then printf '  \033[32mPASS\033[0m %-44s %s\n' "$label" "$got"; pass=$((pass+1))
  else printf '  \033[31mFAIL\033[0m %-44s got %s want %s\n' "$label" "$got" "$want"; fail=$((fail+1)); head -c 160 /tmp/pt.out; echo; fi; }

echo "eKYC"
chk "otp: valid resident"            202 -X POST "${H[@]}" "$BASE/ekyc/v1/otp" -d "{\"aadhaar\":\"$AAD\",\"consent\":\"Y\"}"
chk "otp: consent missing"           400 -X POST "${H[@]}" "$BASE/ekyc/v1/otp" -d "{\"aadhaar\":\"$AAD\"}"
chk "otp: bad check digit"           400 -X POST "${H[@]}" "$BASE/ekyc/v1/otp" -d '{"aadhaar":"999000100008","consent":"Y"}'
chk "otp: not enrolled"              404 -X POST "${H[@]}" "$BASE/ekyc/v1/otp" -d '{"aadhaar":"999000900005","consent":"Y"}'
chk "otp: auth locked"               403 -X POST "${H[@]}" "$BASE/ekyc/v1/otp" -d "{\"aadhaar\":\"$LOCKED\",\"consent\":\"Y\"}"
TXN=$(curl -s -X POST "${H[@]}" "$BASE/ekyc/v1/otp" -d "{\"aadhaar\":\"$AAD\",\"consent\":\"Y\"}" | sed -n 's/.*"txnId":"\([^"]*\)".*/\1/p')
chk "verify: correct otp"            200 -X POST "${H[@]}" "$BASE/ekyc/v1/verify" -d "{\"txnId\":\"$TXN\",\"otp\":\"123456\"}"
TXN2=$(curl -s -X POST "${H[@]}" "$BASE/ekyc/v1/otp" -d "{\"aadhaar\":\"$AAD\",\"consent\":\"Y\"}" | sed -n 's/.*"txnId":"\([^"]*\)".*/\1/p')
chk "verify: wrong otp"              401 -X POST "${H[@]}" "$BASE/ekyc/v1/verify" -d "{\"txnId\":\"$TXN2\",\"otp\":\"000000\"}"
chk "verify: unknown txn"            404 -X POST "${H[@]}" "$BASE/ekyc/v1/verify" -d '{"txnId":"OTP-nope","otp":"123456"}'
chk "demographic: match"             200 -X POST "${H[@]}" "$BASE/ekyc/v1/demographic" -d "{\"aadhaar\":\"$AAD\",\"name\":\"Ananya Krishnan\",\"consent\":\"Y\"}"
chk "demographic: no attributes"     400 -X POST "${H[@]}" "$BASE/ekyc/v1/demographic" -d "{\"aadhaar\":\"$AAD\",\"consent\":\"Y\"}"

echo "PAN"
chk "verify: valid"                  200 -X POST "${H[@]}" "$BASE/pan/v1/verify" -d '{"pan":"AKRPK4417J"}'
chk "verify: surrendered"            200 -X POST "${H[@]}" "$BASE/pan/v1/verify" -d '{"pan":"DXXPS1102L"}'
chk "verify: malformed"              400 -X POST "${H[@]}" "$BASE/pan/v1/verify" -d '{"pan":"ABC123"}'
chk "verify: not found"              404 -X POST "${H[@]}" "$BASE/pan/v1/verify" -d '{"pan":"ZZZZZ9999Z"}'
chk "link-status: linked"            200 -X POST "${H[@]}" "$BASE/pan/v1/link-status" -d "{\"pan\":\"AKRPK4417J\",\"aadhaar\":\"$AAD\"}"

echo "eSign"
HASH=$(printf 'loan agreement' | shasum -a 256 | cut -d' ' -f1)
chk "initiate: valid"                202 -X POST "${H[@]}" "$BASE/esign/v1/initiate" -d "{\"aadhaar\":\"$AAD\",\"documentHash\":\"$HASH\",\"documentName\":\"loan-agreement.pdf\",\"signerConsent\":\"Y\"}"
chk "initiate: bad hash"             400 -X POST "${H[@]}" "$BASE/esign/v1/initiate" -d "{\"aadhaar\":\"$AAD\",\"documentHash\":\"abc\",\"signerConsent\":\"Y\"}"
ETXN=$(curl -s -X POST "${H[@]}" "$BASE/esign/v1/initiate" -d "{\"aadhaar\":\"$AAD\",\"documentHash\":\"$HASH\",\"signerConsent\":\"Y\"}" | sed -n 's/.*"txnId":"\([^"]*\)".*/\1/p')
chk "complete: signed"               200 -X POST "${H[@]}" "$BASE/esign/v1/complete" -d "{\"txnId\":\"$ETXN\",\"otp\":\"123456\"}"

echo "DigiLocker"
chk "documents: list"                200 -X GET "${H[@]}" "$BASE/digilocker/v1/documents?aadhaar=$AAD"
chk "fetch: consented"               200 -X POST "${H[@]}" "$BASE/digilocker/v1/fetch" -d "{\"aadhaar\":\"$AAD\",\"docId\":\"itd-pan-0001\",\"consent\":\"Y\"}"
chk "fetch: no consent"              400 -X POST "${H[@]}" "$BASE/digilocker/v1/fetch" -d "{\"aadhaar\":\"$AAD\",\"docId\":\"itd-pan-0001\"}"
chk "fetch: unavailable doc"         404 -X POST "${H[@]}" "$BASE/digilocker/v1/fetch" -d "{\"aadhaar\":\"$AAD\",\"docId\":\"nope\",\"consent\":\"Y\"}"

echo "Platform"
chk "unidentified partner"           401 -X POST -H "Content-Type: application/json" "$BASE/pan/v1/verify" -d '{"pan":"AKRPK4417J"}'
chk "malformed json"                 400 -X POST "${H[@]}" "$BASE/pan/v1/verify" -d '{"pan":}'
chk "unknown route"                  404 -X GET "${H[@]}" "$BASE/ekyc/v1/nope"
chk "health (no auth)"               200 -X GET "$BASE/health"

printf '\n  %d passed, %d failed\n\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
