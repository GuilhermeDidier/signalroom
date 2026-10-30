"""SSRF-guarded URL fetching for URL documents.

Rules:
- only http/https, only ports 80/443/8080/8443, no credentials in the URL;
- the hostname is resolved once and EVERY resolved address must be public
  (no private, loopback, link-local, CGNAT, multicast, reserved or unspecified);
- the connection goes to the vetted IP (TLS still verifies the real hostname via
  SNI), so a DNS answer cannot change between the check and the request (rebinding);
- redirects are followed by hand, at most 3, each hop re-validated;
- the body is streamed and cut at 2 MB; connect/read timeouts are short.
"""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

MAX_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
ALLOWED_PORTS = {80, 443, 8080, 8443}
TIMEOUT = httpx.Timeout(10.0, connect=5.0)
USER_AGENT = "SignalroomBot/0.1 (+knowledge-base ingestion)"

_CGNAT = ipaddress.ip_network("100.64.0.0/10")


class UnsafeURLError(ValueError):
    """The URL is not allowed (bad scheme, private address, too big, ...)."""


@dataclass(frozen=True)
class FetchedPage:
    url: str
    content_type: str
    body: bytes


def _ip_is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if isinstance(ip, ipaddress.IPv4Address) and ip in _CGNAT:
        return False
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or not ip.is_global
    )


def resolve_public(url: str) -> tuple[str, int, str]:
    """Validate `url` and return (hostname, port, vetted_ip). Raises UnsafeURLError."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise UnsafeURLError("only http and https URLs are allowed")
    if parts.username or parts.password:
        raise UnsafeURLError("credentials in URLs are not allowed")
    host = parts.hostname
    if not host:
        raise UnsafeURLError("URL has no host")
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError as exc:
        raise UnsafeURLError("invalid port") from exc
    if port not in ALLOWED_PORTS:
        raise UnsafeURLError(f"port {port} is not allowed")
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UnsafeURLError(f"cannot resolve host {host!r}") from exc
    ips = {ipaddress.ip_address(info[4][0].split("%")[0]) for info in infos}
    if not ips:
        raise UnsafeURLError(f"cannot resolve host {host!r}")
    blocked = [str(ip) for ip in ips if not _ip_is_public(ip)]
    if blocked:
        raise UnsafeURLError(f"host resolves to a non-public address ({', '.join(blocked)})")
    # Prefer IPv4 for reachability on small hosts.
    chosen = min(ips, key=lambda ip: ip.version)
    return host, port, str(chosen)


def _pinned_request(client: httpx.Client, url: str) -> httpx.Response:
    host, port, ip = resolve_public(url)
    parts = urlsplit(url)
    ip_host = f"[{ip}]" if ":" in ip else ip
    netloc = ip_host if parts.port is None else f"{ip_host}:{port}"
    pinned = urlunsplit((parts.scheme, netloc, parts.path or "/", parts.query, ""))
    host_header = host if parts.port is None else f"{host}:{port}"
    request = client.build_request(
        "GET",
        pinned,
        headers={
            "Host": host_header,
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/pdf,text/plain;q=0.9,*/*;q=0.5",
        },
        extensions={"sni_hostname": host},
    )
    return client.send(request, stream=True)


def fetch_url(url: str) -> FetchedPage:
    with httpx.Client(timeout=TIMEOUT, follow_redirects=False) as client:
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            response = _pinned_request(client, current)
            try:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise UnsafeURLError("redirect without Location")
                    current = urljoin(current, location)
                    continue
                if response.status_code >= 400:
                    raise UnsafeURLError(f"fetch failed with HTTP {response.status_code}")
                declared = response.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > MAX_BYTES:
                    raise UnsafeURLError("document is larger than 2 MB")
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        raise UnsafeURLError("document is larger than 2 MB")
                content_type = response.headers.get("content-type", "").split(";")[0].strip()
                return FetchedPage(url=current, content_type=content_type.lower(), body=bytes(body))
            finally:
                response.close()
        raise UnsafeURLError("too many redirects")
