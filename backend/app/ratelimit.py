"""Shared slowapi limiter. Lives in its own module so routes and main can
both import it without a cycle. Limits are configured in config.Settings.
429 responses include Retry-After (headers_enabled)."""

from slowapi import Limiter
from slowapi.util import get_remote_address

from .config import settings

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[settings.rate_limit_default],
    headers_enabled=True,
)
