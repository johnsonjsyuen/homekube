# Keycloak Setup Guide for TTS Authentication

## 1. Create Realm

1. Click the dropdown in the top-left (shows "master")
2. Click "Create realm"
3. Set **Realm name**: `homekube`
4. Click "Create"

## 2. Create Client

1. Go to **Clients** in the left menu
2. Click "Create client"

### General Settings
| Setting | Value |
|---------|-------|
| Client type | OpenID Connect |
| Client ID | `homepage` |

Click "Next"

### Capability Config
| Setting | Value | Notes |
|---------|-------|-------|
| Client authentication | **OFF** | This is a public SPA client (browser-based), no client secret |
| Authorization | OFF | Not needed |
| Standard flow | **ON** | Required - this is the main OAuth2 authorization code flow |
| Direct access grants | OFF | Not needed - this is for username/password login via API |
| Implicit flow | OFF | Deprecated, not needed with PKCE |
| Service accounts roles | OFF | Only for server-to-server auth |
| OAuth 2.0 Device Authorization Grant | OFF | For TV/device login |
| OIDC CIBA Grant | OFF | For background auth |

Click "Next"

### Login Settings
| Setting | Value |
|---------|-------|
| Root URL | `https://www.johnsonyuen.com` |
| Home URL | (leave empty) |
| Valid redirect URIs | `https://www.johnsonyuen.com/*` |
| Valid post logout redirect URIs | `https://www.johnsonyuen.com/*` |
| Web origins | `+` |

> **For the Tauri desktop/mobile app**, add these additional redirect URIs:
> - Valid redirect URIs: `https://tauri.localhost/*` (Windows, Android, iOS)
> - Valid redirect URIs: `tauri://localhost/*` (macOS, Linux)
> - Valid post logout redirect URIs: `https://tauri.localhost/*`
> - Valid post logout redirect URIs: `tauri://localhost/*`
>
> **For local development**, add these additional redirect URIs:
> - Valid redirect URIs: `http://localhost:5173/*`
> - Valid post logout redirect URIs: `http://localhost:5173/*`

Click "Save"

## 3. Create a Test User

1. Go to **Users** in the left menu
2. Click "Add user"
3. Fill in:
   - Username: `testuser`
   - Email: `test@example.com` (optional)
   - First name: `Test` (optional)
   - Last name: `User` (optional)
   - Email verified: ON
4. Click "Create"
5. Go to the **Credentials** tab
6. Click "Set password"
7. Enter a password and confirm
8. Set "Temporary" to **OFF** (so you don't have to change it on first login)
9. Click "Save"

## 4. Configure Token Audiences

Your services (like the TTS backend) might require a specific "Audience" (`aud` claim) in the JWT token for security.

### 4.1 Create Client Scope
1. Go to **Client scopes** in the left menu
2. Click **Create client scope**
3. Set **Name**: `tts`
4. Set **Type**: `Default`
5. Click **Save**

### 4.2 Add Audience Mapper
1. In the `tts` scope settings, go to the **Mappers** tab
2. Click **Configure a new mapper**
3. Select **Audience**
4. Set **Name**: `tts-audience`
5. Set **Included Custom Audience**: `tts`
6. Set **Add to access token**: **ON**
7. Click **Save**

### 4.3 Assign to Client
1. Go to **Clients** in the left menu
2. Select your client (e.g., `homepage`)
3. Go to the **Client scopes** tab
4. Click **Add client scope**
5. Select `tts`
6. Click **Add** -> **Default**

### 4.4 Add STT (Speech-to-Text) Audience

Repeat the same process for the STT service:

1. Go to **Client scopes** → **Create client scope**
2. Set **Name**: `stt`, **Type**: `Default`, click **Save**
3. Go to **Mappers** tab → **Configure a new mapper** → **Audience**
4. Set **Name**: `stt-audience`
5. Set **Included Custom Audience**: `stt`
6. Set **Add to access token**: **ON**
7. Click **Save**
8. Go to **Clients** → `homepage` → **Client scopes** tab
9. Click **Add client scope** → Select `stt` → **Add** -> **Default**

## 5. Configure WhatsApp Service Role (for cross-user access)

Service accounts that need to send WhatsApp messages on behalf of users require the `whatsapp-service` realm role.

### 5.1 Create Realm Role

1. Go to **Realm roles** in the left menu
2. Click **Create role**
3. Set **Role name**: `whatsapp-service`
4. Set **Description**: `Allows cross-user WhatsApp session access for service accounts`
5. Click **Save**

### 5.2 Assign to a Service Account Client

1. Go to **Clients** → select the service client (e.g., `temporal-worker`)
2. Ensure **Client authentication**: ON and **Service accounts roles**: ON
3. Go to the **Service account roles** tab
4. Click **Assign role**
5. Select `whatsapp-service`
6. Click **Assign**

The role appears in the service account's JWT as:
```json
{
    "realm_access": {
        "roles": ["whatsapp-service", "default-roles-homekube"]
    }
}
```

Without this role, the `userId` parameter on `/api/send` and WebSocket `start_conversation` is rejected with 403 for cross-user requests.

## 6. Configure News Worker Client (for daily news digest)

The news-worker service needs a confidential client with service account access to send WhatsApp messages on behalf of a designated sender.

### 6.1 Create Client

1. Go to **Clients** in the left menu
2. Click "Create client"

| Setting | Value | Notes |
|---------|-------|-------|
| Client type | OpenID Connect | |
| Client ID | `news-worker` | |

Click "Next"

### 6.2 Capability Config

| Setting | Value | Notes |
|---------|-------|-------|
| Client authentication | **ON** | Confidential client with client secret |
| Authorization | OFF | Not needed |
| Standard flow | OFF | Not needed - service account only |
| Direct access grants | OFF | Not needed |
| Service accounts roles | **ON** | Required for client_credentials grant |

Click "Next", then "Save"

### 6.3 Assign WhatsApp Service Role

1. Go to **Clients** → select `news-worker`
2. Go to the **Service account roles** tab
3. Click **Assign role**
4. Select `whatsapp-service`
5. Click **Assign**

This allows the news-worker to send messages on behalf of other users via the WhatsApp `/api/send` endpoint.

### 6.4 Add WhatsApp Client Scope

1. Go to **Clients** → select `news-worker`
2. Go to the **Client scopes** tab
3. Click **Add client scope**
4. Select `whatsapp` (if it exists as a scope) or ensure the `aud` claim includes `whatsapp`
5. Click **Add** → **Default**

### 6.5 Create Kubernetes Secret

```bash
# Get the client secret from Keycloak: Clients → news-worker → Credentials tab
kubectl create secret generic news-worker-keycloak \
  --from-literal=client-secret=<SECRET_FROM_KEYCLOAK> \
  -n temporal
```

### 6.6 Mirror WhatsApp DB Secret to Temporal Namespace

The news-worker reads subscriber data from the WhatsApp database. Mirror the CNPG-generated secret:

```bash
kubectl get secret whatsapp-db-app -o json | \
  jq '.metadata.namespace = "temporal" | del(.metadata.resourceVersion, .metadata.uid, .metadata.creationTimestamp)' | \
  kubectl apply -f -
```

## 7. Configure Grafana Client (for dashboard access with Keycloak login)

Grafana uses its built-in OAuth2/OIDC support to authenticate users via Keycloak.

### 7.1 Create Client

1. Go to **Clients** in the left menu
2. Click "Create client"

### General Settings

| Setting | Value |
|---------|-------|
| Client type | OpenID Connect |
| Client ID | `grafana` |

Click "Next"

### Capability Config

| Setting | Value | Notes |
|---------|-------|-------|
| Client authentication | **ON** | Confidential client — Grafana stores the secret server-side |
| Authorization | OFF | Not needed |
| Standard flow | **ON** | Required for browser-based login redirect |
| Direct access grants | OFF | Not needed |
| Service accounts roles | OFF | Not needed |

Click "Next"

### Login Settings

| Setting | Value |
|---------|-------|
| Root URL | `https://grafana.johnsonyuen.com` |
| Valid redirect URIs | `https://grafana.johnsonyuen.com/*` |
| Valid post logout redirect URIs | `https://grafana.johnsonyuen.com/*` |
| Web origins | `https://grafana.johnsonyuen.com` |

Click "Save"

### 7.2 Create `grafana-admin` Realm Role

1. Go to **Realm roles** in the left menu
2. Click **Create role**
3. Set **Role name**: `grafana-admin`
4. Set **Description**: `Maps to Grafana Admin org role`
5. Click **Save**

Assign this role to users who should have Grafana Admin access. All other authenticated users get Viewer access by default.

### 7.3 Create Kubernetes Secret

```bash
# Get the client secret from Keycloak: Clients → grafana → Credentials tab
kubectl create secret generic grafana-keycloak-secret \
  --from-literal=GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET=<SECRET_FROM_KEYCLOAK> \
  -n monitoring
```

### 7.4 Cloudflare Tunnel Route

Add a public hostname route in the Cloudflare dashboard:

| Setting | Value |
|---------|-------|
| Subdomain | `grafana.johnsonyuen.com` |
| Service | `http://grafana-proxy.default.svc.cluster.local` |

## Summary of Key Settings

```
Realm: homekube
Client ID: homepage
Client Type: Public (no authentication)
Flow: Standard flow with PKCE (automatic with keycloak-js)
```

## Why These Settings?

- **Client authentication OFF**: The frontend runs in the browser and cannot securely store a client secret. Public clients use PKCE instead.

- **Standard flow ON**: This is the OAuth2 Authorization Code flow. The user is redirected to Keycloak to login, then redirected back with a code that gets exchanged for tokens.

- **Direct access grants OFF**: This would allow sending username/password directly via API. It's less secure and not needed since we use the standard flow.

- **Web origins `+`**: The `+` means "allow all origins that match the redirect URIs". This enables CORS for token requests from the browser.

## Frontend Configuration

Create a `.env` file in the `homepage` directory:

```env
VITE_KEYCLOAK_URL=http://localhost:8080
VITE_KEYCLOAK_REALM=homekube
VITE_KEYCLOAK_CLIENT_ID=homepage
```

## Testing the Setup

1. Start the frontend: `npm run dev`
2. Port-forward Keycloak: `kubectl port-forward -n keycloak svc/keycloak 8080:80`
3. Go to http://localhost:5173
4. Click on "Text to Speech" tab
5. Click "Log In"
6. You should be redirected to Keycloak login
7. Enter your test user credentials
8. You should be redirected back and see the TTS form
