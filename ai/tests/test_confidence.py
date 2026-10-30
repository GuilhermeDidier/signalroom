import pytest

from signalroom_ai.confidence import (
    CAP_NOT_ANSWERABLE,
    CAP_UNCITED,
    citation_coverage,
    compute_confidence,
    markers_in,
    retrieval_strength,
)


def test_markers_parsing():
    assert markers_in("A [1]. B [2][3]. C [4, 5].") == [1, 2, 3, 4, 5]


def test_retrieval_strength_is_clamped_linear():
    assert retrieval_strength(0.40) == 0.0
    assert retrieval_strength(0.70) == pytest.approx(0.5)
    assert retrieval_strength(0.80) == 1.0
    assert retrieval_strength(0.95) == 1.0
    assert retrieval_strength(None) == 0.0


def test_coverage_counts_claim_sentences_only():
    text = "Here is what applies:\n- The frame is covered for 10 years [1].\n- Batteries get 2 years of cover [2].\nThanks!"
    cov, claims, cited = citation_coverage(text, {1, 2})
    assert (claims, cited) == (2, 2) and cov == 1.0


def test_invalid_markers_do_not_count():
    cov, claims, cited = citation_coverage("The battery is covered for two years [9].", {1})
    assert (cov, claims, cited) == (0.0, 1, 0)


def test_fully_grounded_answer_scores_high():
    b = compute_confidence(
        "The frame is covered for 10 years [1]. Motors are covered for 2 years [2].",
        {1: 0.86, 2: 0.80, 3: 0.60},
        "yes",
        "how_to",
        searched=True,
    )
    # R = 1.0 (best cited cosine 0.86 >= ceiling), C = 1.0, A = 1.0
    assert b.confidence == pytest.approx(1.0)
    assert b.cap_applied is None and b.mode == "grounded"


def test_formula_weights():
    b = compute_confidence(
        "Returns are accepted within 30 days [1]. Shipping is free on most orders here.",
        {1: 0.70},
        "partial",
        "how_to",
        searched=True,
    )
    # R = (0.70-0.60)/0.20 = 0.5 ; C = 1/2 ; A = 0.5
    assert b.confidence == pytest.approx(round(0.45 * 0.5 + 0.35 * 0.5 + 0.20 * 0.5, 3))


def test_not_answerable_is_capped():
    b = compute_confidence("The policy does not say [1].", {1: 0.9}, "no", "how_to", searched=True)
    assert b.confidence == CAP_NOT_ANSWERABLE and b.cap_applied == "not_answerable"


def test_uncited_answer_is_capped():
    b = compute_confidence(
        "You can return it within 30 days of delivery.", {1: 0.9}, "yes", "how_to", searched=True
    )
    assert b.confidence <= CAP_UNCITED and b.cap_applied == "uncited"


def test_missing_flag_counts_as_half():
    b = compute_confidence(
        "Frames have a lifetime warranty [1].", {1: 0.85}, None, "how_to", searched=True
    )
    assert b.answerable == "missing"
    assert b.confidence == pytest.approx(0.45 + 0.35 + 0.10)


def test_no_kb_modes():
    assert (
        compute_confidence("Hi! How can I help?", {}, "yes", "smalltalk", searched=False).confidence
        == 0.80
    )
    oos = compute_confidence(
        "I can only help with orders.", {}, "yes", "out_of_scope", searched=False
    )
    assert oos.confidence == 0.60 and oos.mode == "no_kb"


def test_deterministic():
    args = ("Batteries last 800 cycles [1].", {1: 0.77}, "yes", "how_to", True)
    assert compute_confidence(*args) == compute_confidence(*args)
