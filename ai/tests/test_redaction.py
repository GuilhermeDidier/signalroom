import pytest

from signalroom_ai.redaction import iban_valid, luhn_valid, redact


def test_email_phone_and_numbering():
    r = redact(
        "Mail jane.doe@example.com or jane.doe@example.com, cc ops@example.org. Call +1 (555) 013-2245."
    )
    assert r.redacted == "Mail [EMAIL_1] or [EMAIL_1], cc [EMAIL_2]. Call [PHONE_1]."
    assert r.counts == {"EMAIL": 3, "PHONE": 1}
    assert r.summary() == [{"type": "EMAIL", "count": 3}, {"type": "PHONE", "count": 1}]


def test_valid_card_is_redacted():
    r = redact("my card is 4111 1111 1111 1111, exp 12/28")
    assert "[CARD_1]" in r.redacted and "4111" not in r.redacted
    assert r.counts["CARD"] == 1


def test_luhn_false_positive_is_kept():
    # 16 digits that fail Luhn: an order or tracking number, not a card.
    r = redact("order 1234 5678 9012 3456 shipped")
    assert r.redacted == "order 1234 5678 9012 3456 shipped"
    assert r.counts == {}


def test_luhn():
    assert luhn_valid("4111111111111111")
    assert luhn_valid("5555555555554444")
    assert not luhn_valid("4111111111111112")
    assert not luhn_valid("abc")


def test_ssn_and_invalid_ssn_ranges():
    assert redact("SSN 123-45-6789").redacted == "SSN [SSN_1]"
    assert redact("id 000-12-3456").counts.get("SSN") is None
    assert redact("id 666-12-3456").counts.get("SSN") is None


def test_iban_with_checksum():
    assert iban_valid("DE89 3704 0044 0532 0130 00")
    assert not iban_valid("DE00 3704 0044 0532 0130 00")
    r = redact("refund to GB82 WEST 1234 5698 7654 32 please")
    assert r.redacted == "refund to [IBAN_1] please"


def test_ip_addresses():
    assert redact("from 192.168.1.20 and 8.8.8.8").redacted == "from [IP_1] and [IP_2]"
    assert redact("version 999.1.1.1").counts.get("IP") is None


def test_dates_prices_and_skus_are_not_pii():
    text = "Bought NW-BAT-500 on 2026-03-14 for $1,299.00, error E-07, invoice INV-20431."
    assert redact(text).redacted == text


def test_text_without_pii_is_unchanged():
    assert redact("How long is the warranty?").redacted == "How long is the warranty?"


@pytest.mark.parametrize(
    "text",
    [
        "call +14155550100 now",  # E.164, no separators
        "my number: 83999998888",  # Brazilian mobile, unseparated
        "ring (415)5550100 today",  # area code in parentheses, rest unseparated
        "whatsapp +55 83999998888",
        "it's 4155550100.",
    ],
)
def test_unseparated_phone_numbers_are_redacted(text):
    r = redact(text)
    assert r.counts == {"PHONE": 1}, r.redacted
    assert "[PHONE_1]" in r.redacted
    assert not any(ch.isdigit() for ch in r.redacted.replace("[PHONE_1]", ""))


@pytest.mark.parametrize(
    "text",
    [
        "order #4815162342 never arrived",
        "Order No. 4815162342 never arrived",
        "invoice 20260314123 is wrong",
        "tracking number 940011189922385 is stuck",
        "ticket: 1234567890",
    ],
)
def test_labelled_long_ids_are_not_phones(text):
    assert redact(text).redacted == text


def test_unseparated_card_is_still_a_card():
    r = redact("card 4111111111111111 please")
    assert r.redacted == "card [CARD_1] please" and r.counts == {"CARD": 1}


def test_lowercase_iban_is_redacted_whole():
    r = redact("refund to gb82 west 1234 5698 7654 32 please")
    assert r.redacted == "refund to [IBAN_1] please"
    assert r.counts == {"IBAN": 1}


def test_iban_followed_by_a_word_keeps_the_word():
    r = redact("send it to AT61 1904 3002 3457 3201 thanks")
    assert r.redacted == "send it to [IBAN_1] thanks"
