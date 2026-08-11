"""Deterministic first-pass filter for user-generated text.

This runs on the server so modified and older clients cannot bypass the same
baseline used by the current app. Reports remain the human-review path for
context and anything a word filter cannot understand.
"""

from __future__ import annotations

import re
import unicodedata

from fastapi import HTTPException


_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bf+u+c+k+(?:e+r|i+n+g)?\b",
        r"\bs+h+i+t+(?:t+y)?\b",
        r"\bb+i+t+c+h+\b",
        r"\bn+i+g+g+(?:e+r+|a+)\b",
        r"\bf+a+g+(?:g+o+t+)?\b",
        r"\bk+i+k+e+\b",
        r"\bc+h+i+n+k+\b",
        r"\br+e+t+a+r+d+(?:e+d+)?\b",
        r"\bk+y+s+\b",
        r"\bkill\s+(?:yourself|urself)\b",
        r"\b(?:child|kid)\s*(?:porn|sex)\b",
        r"\br+a+p+e+\b",
    )
)


def _normalise(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "").casefold()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def is_allowed(value: str) -> bool:
    text = _normalise(value)
    compact = text.replace(" ", "")
    return not any(pattern.search(text) or pattern.search(compact) for pattern in _PATTERNS)


def require_allowed_text(value: str, field: str = "text") -> str:
    cleaned = (value or "").strip()
    if not is_allowed(cleaned):
        raise HTTPException(400, f"{field} contains language that is not allowed")
    return cleaned
