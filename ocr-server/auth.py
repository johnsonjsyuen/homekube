import os
import time
import jwt
import httpx

KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://keycloak.keycloak.svc.cluster.local")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "homekube")
TEST_MODE = os.getenv("OCR_TEST_MODE")

_jwks_cache: dict = {}
_jwks_fetched_at: float = 0
JWKS_CACHE_TTL = 3600  # 1 hour


async def _fetch_jwks(force: bool = False) -> dict:
    global _jwks_cache, _jwks_fetched_at
    now = time.time()
    if not force and _jwks_cache and (now - _jwks_fetched_at) < JWKS_CACHE_TTL:
        return _jwks_cache
    url = f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, timeout=10)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_fetched_at = time.time()
        return _jwks_cache


def _get_signing_key(jwks: dict, kid: str):
    for key in jwks.get("keys", []):
        if key["kid"] == kid:
            return jwt.algorithms.RSAAlgorithm.from_jwk(key)
    raise ValueError(f"Key {kid} not found in JWKS")


async def validate_token(token: str) -> dict:
    """Validate a Keycloak JWT token and return claims."""
    if TEST_MODE:
        return {"sub": "test_user", "preferred_username": "test_user"}

    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    if not kid:
        raise ValueError("Token missing kid header")

    jwks = await _fetch_jwks()
    try:
        public_key = _get_signing_key(jwks, kid)
    except ValueError:
        # Key rotation: force refresh and retry once
        jwks = await _fetch_jwks(force=True)
        public_key = _get_signing_key(jwks, kid)

    claims = jwt.decode(
        token,
        public_key,
        algorithms=["RS256"],
        audience="homepage",
        options={"verify_aud": True},
    )
    return claims
