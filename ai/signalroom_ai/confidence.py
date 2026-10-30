"""Deterministic answer confidence.

    confidence = 0.45 * R + 0.35 * C + 0.20 * A        (then the caps below)

R - retrieval strength, in [0, 1]
    Best cosine similarity among the chunks the answer actually cites (falling
    back to the best retrieved chunk when nothing is cited), mapped linearly from
    [COS_FLOOR, COS_CEIL] = [0.60, 0.80] to [0, 1] and clamped. Calibrated on the
    seed eval with bge-small-en-v1.5 + the BGE query instruction: the top-1 cosine
    of in-scope questions averaged 0.73 (min 0.61); out-of-scope questions averaged
    0.585 (max 0.72). The two ranges overlap, which is why R is only one of
    three signals.
C - citation coverage, in [0, 1]
    Share of the answer's claim sentences (4+ words, not a lead-in ending in ":")
    that carry at least one valid [n] marker pointing at a retrieved chunk.
    Markers that point at nothing count as uncited.
A - the model's own answerable flag: yes = 1.0, partial = 0.5, no = 0.0,
    missing = 0.5.

Caps (applied in this order):
- A == "no"                         -> at most 0.30 (the model says it cannot answer)
- no valid citation at all          -> at most 0.35 (an ungrounded answer)

No-KB replies: for `smalltalk` and `out_of_scope` turns where the model neither
searched nor cited, R and C do not apply; confidence is a fixed 0.80 for
smalltalk and 0.60 for an out-of-scope deflection (a polite "I can only help
with X" is the correct reply, so it should not raise a ticket by itself).

Every input is a number we can recompute later from the stored message, so the
same answer always gets the same score.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass

COS_FLOOR = 0.60
COS_CEIL = 0.80
W_RETRIEVAL = 0.45
W_COVERAGE = 0.35
W_ANSWERABLE = 0.20
CAP_NOT_ANSWERABLE = 0.30
CAP_UNCITED = 0.35
NO_KB_CONFIDENCE = {"smalltalk": 0.80, "out_of_scope": 0.60}
ANSWERABLE_SCORE = {"yes": 1.0, "partial": 0.5, "no": 0.0}

MARKER = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
_LIST_MARKER = re.compile(r"^(?:[-*•]|\d+[.)])\s+")


@dataclass
class ConfidenceBreakdown:
    retrieval_strength: float
    citation_coverage: float
    answerable: str
    answerable_score: float
    top_cited_cosine: float | None
    claim_sentences: int
    cited_sentences: int
    cap_applied: str | None
    mode: str  # "grounded" | "no_kb"
    confidence: float

    def to_dict(self) -> dict:
        return asdict(self)


def markers_in(text: str) -> list[int]:
    """All citation numbers in order of appearance; '[1, 3]' yields 1 and 3."""
    out: list[int] = []
    for m in MARKER.finditer(text):
        out.extend(int(n) for n in re.split(r"\s*,\s*", m.group(1)))
    return out


def claim_sentences(text: str) -> list[str]:
    sentences = []
    for raw in _SENTENCE_SPLIT.split(text):
        s = _LIST_MARKER.sub("", raw.strip())
        bare = MARKER.sub("", s).strip()
        if len(bare.split()) >= 4 and not bare.endswith(":"):
            sentences.append(s)
    return sentences


def retrieval_strength(cosine: float | None) -> float:
    if cosine is None:
        return 0.0
    return max(0.0, min(1.0, (cosine - COS_FLOOR) / (COS_CEIL - COS_FLOOR)))


def citation_coverage(text: str, valid_ns: set[int]) -> tuple[float, int, int]:
    claims = claim_sentences(text)
    if not claims:
        return 0.0, 0, 0
    cited = sum(1 for s in claims if any(n in valid_ns for n in markers_in(s)))
    return cited / len(claims), len(claims), cited


def compute_confidence(
    answer: str,
    source_cosines: dict[int, float],
    answerable: str | None,
    intent: str,
    searched: bool,
) -> ConfidenceBreakdown:
    """`source_cosines` maps each citable number [n] to that chunk's cosine."""
    flag = answerable if answerable in ANSWERABLE_SCORE else "missing"
    a_score = ANSWERABLE_SCORE.get(flag, 0.5)
    valid = set(source_cosines)
    used = [n for n in markers_in(answer) if n in valid]

    if intent in NO_KB_CONFIDENCE and not searched and not used:
        value = NO_KB_CONFIDENCE[intent]
        return ConfidenceBreakdown(0.0, 0.0, flag, a_score, None, 0, 0, None, "no_kb", value)

    if used:
        top = max(source_cosines[n] for n in used)
    else:
        top = max(source_cosines.values(), default=None)
    r = retrieval_strength(top)
    c, n_claims, n_cited = citation_coverage(answer, valid)
    value = W_RETRIEVAL * r + W_COVERAGE * c + W_ANSWERABLE * a_score

    cap = None
    if flag == "no" and value > CAP_NOT_ANSWERABLE:
        value, cap = CAP_NOT_ANSWERABLE, "not_answerable"
    elif not used and value > CAP_UNCITED:
        value, cap = CAP_UNCITED, "uncited"
    return ConfidenceBreakdown(
        retrieval_strength=round(r, 4),
        citation_coverage=round(c, 4),
        answerable=flag,
        answerable_score=a_score,
        top_cited_cosine=None if top is None else round(top, 4),
        claim_sentences=n_claims,
        cited_sentences=n_cited,
        cap_applied=cap,
        mode="grounded",
        confidence=round(value, 3),
    )
