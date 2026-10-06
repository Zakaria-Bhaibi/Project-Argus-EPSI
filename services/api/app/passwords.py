"""scrypt password hashing (stdlib only, so manage_users.py runs on a bare VM python3)."""
import base64
import hashlib
import hmac
import os

N, R, P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=N, r=R, p=P)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def check_password(password: str, stored: str) -> bool:
    try:
        _, salt_b64, digest_b64 = stored.split("$")
        digest = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt_b64), n=N, r=R, p=P)
        return hmac.compare_digest(digest, base64.b64decode(digest_b64))
    except ValueError:
        return False
