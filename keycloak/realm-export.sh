#!/usr/bin/env bash
set -euo pipefail

# --- Configuration ---
NAMESPACE="keycloak"
SERVICE_NAME="keycloak"
SERVICE_PORT=80
ADMIN_SECRET_NAME="keycloak-admin"
REALM_NAME="homekube"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_FILE="${SCRIPT_DIR}/k8s/realm-export.json"

# --- Helpers ---
cleanup() {
    if [[ -n "${PORT_FORWARD_PID:-}" ]]; then
        kill "${PORT_FORWARD_PID}" 2>/dev/null || true
        wait "${PORT_FORWARD_PID}" 2>/dev/null || true
    fi
}
trap cleanup EXIT

log() { echo "==> $*"; }
err() { echo "ERROR: $*" >&2; exit 1; }

check_deps() {
    local missing=()
    for cmd in kubectl jq; do
        if ! command -v "$cmd" &>/dev/null; then
            missing+=("$cmd")
        fi
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        err "Missing required dependencies: ${missing[*]}"
    fi
}

# --- Port-forward management ---
start_port_forward() {
    local local_port
    local_port=$(shuf -i 20000-60000 -n 1)

    log "Starting port-forward on localhost:${local_port} -> ${SERVICE_NAME}:${SERVICE_PORT}"
    kubectl port-forward \
        -n "${NAMESPACE}" \
        "svc/${SERVICE_NAME}" \
        "${local_port}:${SERVICE_PORT}" \
        &>/dev/null &
    PORT_FORWARD_PID=$!

    # Wait for port-forward to be ready
    local retries=0
    while ! curl -sf "http://localhost:${local_port}/" &>/dev/null; do
        if ! kill -0 "${PORT_FORWARD_PID}" 2>/dev/null; then
            err "Port-forward process died unexpectedly"
        fi
        retries=$((retries + 1))
        if [[ $retries -ge 30 ]]; then
            err "Port-forward did not become ready within 30 seconds"
        fi
        sleep 1
    done

    KEYCLOAK_URL="http://localhost:${local_port}"
    log "Port-forward ready at ${KEYCLOAK_URL}"
}

# --- Admin credentials and token ---
get_admin_credentials() {
    log "Fetching admin credentials from secret '${ADMIN_SECRET_NAME}'"
    ADMIN_USER=$(kubectl get secret -n "${NAMESPACE}" "${ADMIN_SECRET_NAME}" \
        -o jsonpath='{.data.username}' | base64 -d)
    ADMIN_PASS=$(kubectl get secret -n "${NAMESPACE}" "${ADMIN_SECRET_NAME}" \
        -o jsonpath='{.data.password}' | base64 -d)

    if [[ -z "${ADMIN_USER}" || -z "${ADMIN_PASS}" ]]; then
        err "Failed to read admin credentials from secret"
    fi
}

get_admin_token() {
    log "Obtaining admin access token"
    local response
    response=$(curl -sf -X POST \
        "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
        -d "client_id=admin-cli" \
        -d "grant_type=password" \
        -d "username=${ADMIN_USER}" \
        -d "password=${ADMIN_PASS}")

    ADMIN_TOKEN=$(echo "${response}" | jq -r '.access_token')
    if [[ -z "${ADMIN_TOKEN}" || "${ADMIN_TOKEN}" == "null" ]]; then
        err "Failed to obtain admin access token"
    fi
}

# --- Export ---
do_export() {
    check_deps
    start_port_forward
    get_admin_credentials
    get_admin_token

    log "Exporting realm '${REALM_NAME}' via partial-export API"
    local raw_export
    raw_export=$(curl -sf -X POST \
        "${KEYCLOAK_URL}/admin/realms/${REALM_NAME}/partial-export?exportClients=true&exportGroupsAndRoles=true" \
        -H "Authorization: Bearer ${ADMIN_TOKEN}" \
        -H "Content-Type: application/json")

    if [[ -z "${raw_export}" ]]; then
        err "Partial export returned empty response"
    fi

    log "Stripping secrets from export"
    local sanitized
    sanitized=$(echo "${raw_export}" | jq '
        # Replace client secrets with placeholder
        if .clients then
            .clients |= map(
                if .secret then .secret = "CHANGE_ME" else . end
            )
        else . end
        |
        # Remove user credentials
        if .users then
            .users |= map(del(.credentials))
        else . end
        |
        # Remove SMTP password
        if .smtpServer.password then
            .smtpServer.password = ""
        else . end
    ')

    mkdir -p "$(dirname "${OUTPUT_FILE}")"
    echo "${sanitized}" | jq '.' > "${OUTPUT_FILE}"
    log "Saved export to ${OUTPUT_FILE}"

    # Print summary
    echo ""
    echo "--- Export Summary ---"
    echo "Realm:           $(echo "${sanitized}" | jq -r '.realm // "unknown"')"
    echo "Clients:         $(echo "${sanitized}" | jq '.clients | length')"
    echo "Client Scopes:   $(echo "${sanitized}" | jq '.clientScopes | length')"
    echo "Realm Roles:     $(echo "${sanitized}" | jq '.roles.realm | length')"
    echo "Groups:          $(echo "${sanitized}" | jq '.groups | length')"
    echo "Identity Provs:  $(echo "${sanitized}" | jq '.identityProviders | length')"
    echo "---------------------"
    echo ""
    echo "Review the export and commit it to the repo."
    echo "Client secrets have been replaced with 'CHANGE_ME'."
}

# --- Import ---
do_import() {
    cat <<'INSTRUCTIONS'

Keycloak Realm Import
=====================

To apply the exported realm config:

  kubectl apply -k keycloak/k8s/

This creates/updates the ConfigMap 'keycloak-realm-config' containing the
realm JSON, then you need to restart Keycloak to pick up changes:

  kubectl rollout restart deployment/keycloak -n keycloak

IMPORTANT: The --import-realm flag only imports a realm on first boot when
the realm does not already exist. For an existing realm, you have two options:

  1. Delete the realm first via the Admin Console or API, then restart
     Keycloak so it re-imports from the ConfigMap.

  2. Use the Admin REST API to update the realm directly:
     PUT /admin/realms/homekube with the realm JSON body.

INSTRUCTIONS
}

# --- Main ---
usage() {
    echo "Usage: $(basename "$0") <export|import>"
    echo ""
    echo "  export    Export the '${REALM_NAME}' realm to ${OUTPUT_FILE}"
    echo "  import    Print instructions for importing the realm config"
    exit 1
}

case "${1:-}" in
    export)  do_export  ;;
    import)  do_import  ;;
    *)       usage      ;;
esac
