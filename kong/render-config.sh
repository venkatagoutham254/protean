#!/bin/sh
# Render kong.yml from kong.yml.template, substituting the credentials in .env.
#
# Kong's native {vault://env/...} references were tried and do not work for this
# deployment: in DB-less declarative mode they are stored verbatim instead of
# resolved, and consumer.custom_id is not a referenceable field in any mode.
# The failure is silent -- Kong boots clean and every request 401s because the
# stored credential is the literal text "{vault://env/ICICI_API_KEY}".
#
# So the substitution happens here instead, before Kong ever reads the file.
# kong.yml is gitignored; kong.yml.template is what lives in version control.
set -eu

cd "$(dirname "$0")"

[ -f .env ] || { echo "error: .env not found. Run: cp .env.example .env" >&2; exit 1; }

# shellcheck disable=SC1091
. ./.env

for v in AFORO_INGEST_KEY ICICI_API_KEY ICICI_CUSTOMER_ID; do
    eval "value=\${$v:-}"
    case "$value" in
        ''|*REPLACE_ME*)
            echo "error: $v is unset or still a placeholder in .env" >&2
            exit 1
            ;;
    esac
done

export AFORO_INGEST_KEY ICICI_API_KEY ICICI_CUSTOMER_ID

if command -v envsubst >/dev/null 2>&1; then
    envsubst '${AFORO_INGEST_KEY} ${ICICI_API_KEY} ${ICICI_CUSTOMER_ID}' \
        < kong.yml.template > kong.yml
else
    # envsubst ships with gettext, which is not installed by default on macOS.
    sed -e "s|\${AFORO_INGEST_KEY}|$AFORO_INGEST_KEY|g" \
        -e "s|\${ICICI_API_KEY}|$ICICI_API_KEY|g" \
        -e "s|\${ICICI_CUSTOMER_ID}|$ICICI_CUSTOMER_ID|g" \
        kong.yml.template > kong.yml
fi

chmod 600 kong.yml
echo "wrote kong.yml (gitignored) from kong.yml.template"
