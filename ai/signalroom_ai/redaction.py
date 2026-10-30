"""PII redaction applied to every user message before any LLM call.

Detectors run in a fixed order (most specific first) and each match is replaced by a
numbered placeholder such as ``[EMAIL_1]``. The same value gets the same placeholder
within one text, so the model can still tell "the same card twice" from "two cards".

Validation keeps false positives down:
- CARD: 13-19 digits that pass the Luhn checksum (order numbers usually do not).
- IBAN: country code + check digits that pass ISO 13616 mod-97.
- IP: four octets, each 0-255.
- SSN: US format NNN-NN-NNNN, excluding the ranges the SSA never issues.
- PHONE: 7-15 digits with phone-style grouping; ISO dates are not phones.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field

PII_TYPES = ("EMAIL", "IBAN", "CARD", "SSN", "IP", "PHONE")

_EMAIL = re.compile(r"(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![\w-])")
_IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b")
_CARD = re.compile(r"(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])")
_SSN = re.compile(r"(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])")
_IP = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
_PHONE = re.compile(
    r"(?<![\w+])(?<!\d[ .-])"
    r"(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,4}\)[ .-]?)?"
    r"\d{2,4}(?:[ .-]\d{2,4}){1,4}"
    r"(?![ .-]?\d)"
)
_ISO_DATE = re.compile(r"^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$")


def luhn_valid(digits: str) -> bool:
    """Luhn checksum over a string of digits."""
    if not digits.isdigit():
        return False
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def iban_valid(raw: str) -> bool:
    """ISO 13616 mod-97 check."""
    iban = raw.replace(" ", "").upper()
    if not 15 <= len(iban) <= 34:
        return False
    rearranged = iban[4:] + iban[:4]
    numeric = "".join(str(int(c, 36)) for c in rearranged)
    return int(numeric) % 97 == 1


def _card_ok(m: str) -> bool:
    digits = re.sub(r"[ -]", "", m)
    return 13 <= len(digits) <= 19 and luhn_valid(digits)


def _ip_ok(m: str) -> bool:
    return all(int(p) <= 255 for p in m.split("."))


def _phone_ok(m: str) -> bool:
    if _ISO_DATE.match(m):
        return False
    n = sum(c.isdigit() for c in m)
    return 7 <= n <= 15


_DETECTORS: list[tuple[str, re.Pattern[str], Callable[[str], bool]]] = [
    ("EMAIL", _EMAIL, lambda m: True),
    ("IBAN", _IBAN, iban_valid),
    ("CARD", _CARD, _card_ok),
    ("SSN", _SSN, lambda m: True),
    ("IP", _IP, _ip_ok),
    ("PHONE", _PHONE, _phone_ok),
]


@dataclass
class RedactionResult:
    redacted: str
    counts: dict[str, int] = field(default_factory=dict)

    def summary(self) -> list[dict]:
        """Contract shape: [{"type": "EMAIL", "count": 2}, ...] in detector order."""
        return [{"type": t, "count": self.counts[t]} for t in PII_TYPES if self.counts.get(t)]


def _replacer(kind: str, ok: Callable[[str], bool], counts: dict[str, int]):
    seen: dict[str, str] = {}

    def _sub(match: re.Match[str]) -> str:
        value = match.group(0)
        if not ok(value):
            return value
        if value not in seen:
            seen[value] = f"[{kind}_{len(seen) + 1}]"
        counts[kind] = counts.get(kind, 0) + 1
        return seen[value]

    return _sub


def redact(text: str) -> RedactionResult:
    counts: dict[str, int] = {}
    for kind, pattern, ok in _DETECTORS:
        text = pattern.sub(_replacer(kind, ok, counts), text)
    return RedactionResult(redacted=text, counts=counts)
