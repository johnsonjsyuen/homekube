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
