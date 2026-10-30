import socket

import pytest

from signalroom_ai import safe_fetch
from signalroom_ai.safe_fetch import UnsafeURLError, resolve_public


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/x",
        "gopher://example.com/",
        "http://127.0.0.1/",
        "http://localhost:80/",
        "http://[::1]/",
        "http://169.254.169.254/latest/meta-data/",  # cloud metadata
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "http://172.16.0.1/",
        "http://100.64.0.1/",  # CGNAT
        "http://0.0.0.0/",
        "http://2130706433/",  # 127.0.0.1 as a decimal integer
        "http://[::ffff:127.0.0.1]/",  # IPv4-mapped loopback
        "http://user:pass@example.com/",
        "http://example.com:22/",
    ],
)
def test_blocked_urls(url):
    with pytest.raises(UnsafeURLError):
        resolve_public(url)


def _fake_resolver(ip):
    def fake(host, port, *args, **kwargs):
        family = socket.AF_INET6 if ":" in ip else socket.AF_INET
        return [(family, socket.SOCK_STREAM, 6, "", (ip, port))]

    return fake


def test_hostname_resolving_to_private_ip_is_blocked(monkeypatch):
    # e.g. a public-looking name whose DNS points at the internal network
    monkeypatch.setattr(safe_fetch.socket, "getaddrinfo", _fake_resolver("10.1.2.3"))
    with pytest.raises(UnsafeURLError, match="non-public"):
        resolve_public("https://docs.attacker.example/")


def test_public_host_is_allowed_and_pinned(monkeypatch):
    monkeypatch.setattr(safe_fetch.socket, "getaddrinfo", _fake_resolver("93.184.215.14"))
    assert resolve_public("https://docs.example.com/help") == (
        "docs.example.com",
        443,
        "93.184.215.14",
    )


def test_redirect_to_private_address_is_blocked(monkeypatch):
    import httpx

    calls = []

    def fake_resolve(url):
        calls.append(url)
        if "internal" in url:
            raise UnsafeURLError("host resolves to a non-public address (10.0.0.1)")
        return ("public.example.com", 443, "93.184.215.14")

    def handler(request):
        return httpx.Response(302, headers={"location": "http://internal.example/admin"})

    monkeypatch.setattr(safe_fetch, "resolve_public", fake_resolve)
    real_client = httpx.Client
    monkeypatch.setattr(
        safe_fetch.httpx,
        "Client",
        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    )
    with pytest.raises(UnsafeURLError, match="non-public"):
        safe_fetch.fetch_url("https://public.example.com/start")
    assert calls == ["https://public.example.com/start", "http://internal.example/admin"]


def test_body_over_2mb_is_rejected(monkeypatch):
    import httpx

    def handler(request):
        return httpx.Response(
            200, headers={"content-type": "text/html"}, content=b"x" * (2 * 1024 * 1024 + 10)
        )

    monkeypatch.setattr(
        safe_fetch, "resolve_public", lambda url: ("public.example.com", 443, "93.184.215.14")
    )
    real_client = httpx.Client
    monkeypatch.setattr(
        safe_fetch.httpx,
        "Client",
        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    )
    with pytest.raises(UnsafeURLError, match="2 MB"):
        safe_fetch.fetch_url("https://public.example.com/big")
