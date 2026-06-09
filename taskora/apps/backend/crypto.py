"""App-layer encryption for secrets stored at rest (currently BYO AI keys in
business_ai_settings.api_key).

Uses Fernet (AES-128-CBC + HMAC-SHA256, authenticated) with a key from the
APP_ENCRYPTION_KEY env var. Design goals:

- **No big-bang migration.** Ciphertext is tagged with the `enc::v1::` prefix,
  so a value's encryption state is unambiguous. `decrypt_secret` returns
  un-prefixed (legacy plaintext) values unchanged, and `encrypt_secret` is a
  no-op on already-encrypted values. Existing plaintext rows keep working and
  get encrypted on their next write — no backfill required.
- **Fails safe in dev.** When APP_ENCRYPTION_KEY is unset, secrets are stored
  as-is (with a loud warning) so local dev keeps working. Production MUST set
  the key (a urlsafe-base64 32-byte Fernet key, e.g. `Fernet.generate_key()`).
"""
import logging
from typing import Optional

from config import get_settings

logger = logging.getLogger(__name__)

_PREFIX = "enc::v1::"


def _fernet():
    key = get_settings().app_encryption_key
    if not key:
        return None
    from cryptography.fernet import Fernet
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_secret(plaintext: Optional[str]) -> Optional[str]:
    """Encrypt a secret for storage. Idempotent (skips already-encrypted values);
    returns the input unchanged for empty values or when no key is configured."""
    if not plaintext or plaintext.startswith(_PREFIX):
        return plaintext
    f = _fernet()
    if f is None:
        logger.warning("APP_ENCRYPTION_KEY unset — storing secret as plaintext")
        return plaintext
    return _PREFIX + f.encrypt(plaintext.encode()).decode()


def decrypt_secret(value: Optional[str]) -> Optional[str]:
    """Decrypt a stored secret. Legacy plaintext (no prefix) is returned as-is.
    A decryption failure returns None rather than leaking ciphertext."""
    if not value or not value.startswith(_PREFIX):
        return value
    f = _fernet()
    if f is None:
        logger.error("APP_ENCRYPTION_KEY unset but ciphertext present — cannot decrypt")
        return None
    from cryptography.fernet import InvalidToken
    try:
        return f.decrypt(value[len(_PREFIX):].encode()).decode()
    except InvalidToken:
        logger.error("Failed to decrypt secret — APP_ENCRYPTION_KEY mismatch?")
        return None
