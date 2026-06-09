"""At-rest encryption of stored secrets (crypto.py + business_ai_settings)."""
import os

import pytest
from cryptography.fernet import Fernet

from config import get_settings


@pytest.fixture
def with_key(monkeypatch):
    """Provision an APP_ENCRYPTION_KEY and reset the cached settings around it."""
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("APP_ENCRYPTION_KEY", key)
    get_settings.cache_clear()
    yield key
    get_settings.cache_clear()


def test_round_trip(with_key):
    from crypto import encrypt_secret, decrypt_secret
    ct = encrypt_secret("sk-ant-supersecret")
    assert ct.startswith("enc::v1::")          # tagged ciphertext
    assert "supersecret" not in ct             # not stored in the clear
    assert decrypt_secret(ct) == "sk-ant-supersecret"


def test_encrypt_is_idempotent(with_key):
    from crypto import encrypt_secret
    once = encrypt_secret("k")
    assert encrypt_secret(once) == once        # already-encrypted → unchanged


def test_decrypt_passes_through_legacy_plaintext(with_key):
    from crypto import decrypt_secret
    # A pre-encryption row has no prefix — returned unchanged (no big-bang backfill).
    assert decrypt_secret("plain-legacy-key") == "plain-legacy-key"


def test_no_key_stores_plaintext(monkeypatch):
    """Dev-safe: with no key configured, encrypt is a no-op (plaintext stored)."""
    monkeypatch.delenv("APP_ENCRYPTION_KEY", raising=False)
    get_settings.cache_clear()
    from crypto import encrypt_secret, decrypt_secret
    assert encrypt_secret("k") == "k"
    assert decrypt_secret("k") == "k"
    get_settings.cache_clear()


def test_resolve_config_decrypts_stored_key(with_key):
    """resolve_config returns the usable (decrypted) key for the LLM client."""
    from crypto import encrypt_secret
    from ai.program_summary import resolve_config
    from tests._fake_supabase import FakeSupabase

    sb = FakeSupabase({
        "business_ai_settings": [{
            "business_id": "BIZ1", "provider": "anthropic",
            "api_key": encrypt_secret("sk-ant-livekey"), "model": None,
        }],
    })
    cfg = resolve_config(sb, "BIZ1")
    assert cfg["api_key"] == "sk-ant-livekey"   # decrypted for use
