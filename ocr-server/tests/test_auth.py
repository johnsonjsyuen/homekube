import os
import pytest
from unittest.mock import patch


@pytest.mark.asyncio
async def test_validate_token_test_mode():
    """In test mode, any token should be accepted."""
    with patch.dict(os.environ, {"OCR_TEST_MODE": "1"}):
        import importlib
        import auth
        importlib.reload(auth)

        claims = await auth.validate_token("any-token")
        assert claims["sub"] == "test_user"
        assert claims["preferred_username"] == "test_user"


@pytest.mark.asyncio
async def test_validate_token_missing_kid():
    """Token without kid should raise ValueError."""
    with patch.dict(os.environ, {}, clear=True):
        import importlib
        import auth
        if "OCR_TEST_MODE" in os.environ:
            del os.environ["OCR_TEST_MODE"]
        importlib.reload(auth)

        import jwt as pyjwt
        token = pyjwt.encode({"sub": "test"}, "secret", algorithm="HS256")

        with pytest.raises(Exception):
            await auth.validate_token(token)
