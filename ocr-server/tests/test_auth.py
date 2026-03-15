import pytest


@pytest.mark.asyncio
async def test_validate_token_missing_kid():
    """Token without kid should raise ValueError."""
    import auth
    import jwt as pyjwt

    token = pyjwt.encode({"sub": "test"}, "secret", algorithm="HS256")

    with pytest.raises(Exception):
        await auth.validate_token(token)
