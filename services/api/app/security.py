"""Authentication (JWT + roles), password hashing, service tokens and rate limiting."""
from __future__ import annotations

import hmac
import json
import time
from collections import defaultdict
from pathlib import Path

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .passwords import check_password, hash_password

ROLES = {"viewer": 0, "operator": 1}
_bearer = HTTPBearer(auto_error=False)


class UserStore:
    """users.json: {"alice": {"role": "operator", "password": "scrypt$..."}} (create with manage_users.py)."""

    def __init__(self, path: Path | None):
        self.users = json.loads(path.read_text()) if path and path.exists() else {}

    def authenticate(self, username: str, password: str) -> str | None:
        u = self.users.get(username)
        # always run one scrypt so timing doesn't reveal which usernames exist
        ok = check_password(password, u["password"] if u else hash_password("x"))
        return u["role"] if u and ok else None


# --- JWT ------------------------------------------------------------------------------------
class Tokens:
    def __init__(self, secret: str, ttl_s: int):
        self.secret, self.ttl_s = secret, ttl_s

    def issue(self, username: str, role: str) -> str:
        now = int(time.time())
        return jwt.encode({"sub": username, "role": role, "iat": now, "exp": now + self.ttl_s}, self.secret, "HS256")

    def decode(self, token: str) -> dict:
        try:
            claims = jwt.decode(token, self.secret, algorithms=["HS256"], options={"require": ["exp", "sub", "role"]})
        except jwt.PyJWTError:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")
        if claims["role"] not in ROLES:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid role")
        return claims


def require(role: str):
    """FastAPI dependency: a valid JWT with at least `role`."""
    def dep(request: Request, cred: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
        if cred is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing token")
        claims = request.app.state.tokens.decode(cred.credentials)
        if ROLES[claims["role"]] < ROLES[role]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"{role} role required")
        return claims
    return dep


def require_service(request: Request, cred: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str:
    """Service-to-service token (vision script, decoy) for POST /alerts."""
    tokens: set[str] = request.app.state.settings.service_tokens
    if cred is None or not any(hmac.compare_digest(cred.credentials, t) for t in tokens):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid service token")
    return "service"


# --- rate limiting (token bucket per client IP and route) -----------------------------------
class RateLimiter:
    def __init__(self):
        self.buckets: dict[tuple[str, str], list[float]] = defaultdict(lambda: [0.0, 0.0])

    def check(self, key: tuple[str, str], rate_per_s: float, burst: int) -> bool:
        tokens, last = self.buckets[key]
        now = time.monotonic()
        tokens = min(burst, (tokens if last else burst) + (now - last) * rate_per_s)
        if tokens < 1:
            self.buckets[key] = [tokens, now]
            return False
        self.buckets[key] = [tokens - 1, now]
        return True


def rate_limit(name: str, rate_per_s: float, burst: int):
    def dep(request: Request) -> None:
        ip = request.client.host if request.client else "?"
        if not request.app.state.limiter.check((ip, name), rate_per_s, burst):
            request.app.state.pipeline.security_event("rate_limited", "warning", "api",
                                                      f"rate limit hit on {name} from {ip}", {"ip": ip})
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "slow down")
    return dep
