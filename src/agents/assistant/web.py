"""Web search and page reading for the assistant, through Tavily.

Tavily fetches pages on its side, so the server never requests a URL a user
or model chose. Without a Tavily key, `fetch_page` falls back to a direct
request that refuses private, loopback and cluster-internal addresses.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from core import settings

TAVILY = "https://api.tavily.com"
MAX_PAGE_CHARS = 12_000


class WebError(RuntimeError):
    pass


@dataclass
class SearchHit:
    title: str
    url: str
    content: str
    published: str | None = None
    score: float | None = None


def _tavily_key() -> str:
    if not settings.TAVILY_API_KEY:
        raise WebError("Web search isn't configured on this server (TAVILY_API_KEY).")
    return settings.TAVILY_API_KEY.get_secret_value()


async def search(
    query: str,
    *,
    max_results: int = 5,
    topic: Literal["general", "news"] = "general",
    days: int | None = None,
    depth: Literal["basic", "advanced"] = "basic",
) -> list[SearchHit]:
    body: dict[str, Any] = {
        "query": query,
        "max_results": max_results,
        "topic": topic,
        "search_depth": depth,
    }
    if days and topic == "news":
        body["days"] = days
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            f"{TAVILY}/search", json=body, headers={"Authorization": f"Bearer {_tavily_key()}"}
        )
    if res.status_code >= 400:
        raise WebError(f"Web search failed (HTTP {res.status_code}).")
    return [
        SearchHit(
            title=r.get("title") or r.get("url", ""),
            url=r["url"],
            content=(r.get("content") or "").strip(),
            published=r.get("published_date"),
            score=r.get("score"),
        )
        for r in res.json().get("results", [])
        if r.get("url")
    ]


async def extract(urls: list[str]) -> dict[str, str]:
    """Readable text of each page, by URL. Pages that fail are left out."""
    if not settings.TAVILY_API_KEY:
        pages = await asyncio.gather(*(_direct_fetch(u) for u in urls), return_exceptions=True)
        return {u: p for u, p in zip(urls, pages, strict=True) if isinstance(p, str) and p}
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(
            f"{TAVILY}/extract",
            json={"urls": urls, "format": "markdown"},
            headers={"Authorization": f"Bearer {_tavily_key()}"},
        )
    if res.status_code >= 400:
        raise WebError(f"Reading the page failed (HTTP {res.status_code}).")
    return {
        r["url"]: r.get("raw_content") or "" for r in res.json().get("results", []) if r.get("url")
    }


def _public_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        addr = ipaddress.ip_address(info[4][0])
        if not addr.is_global or addr.is_multicast:
            return False
    return True


@dataclass(frozen=True)
class Fetched:
    url: str  # after redirects
    content_type: str
    content: bytes

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")


async def public_get(url: str, *, timeout: float = 20, max_bytes: int = 5_000_000) -> Fetched:
    """GET a public http(s) URL, following up to 5 redirects and refusing private addresses."""
    current = url
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        for _ in range(5):
            parsed = urlparse(current)
            if parsed.scheme not in ("http", "https") or not parsed.hostname:
                raise WebError("Only http and https links can be read.")
            if not await asyncio.to_thread(_public_host, parsed.hostname):
                raise WebError("That address isn't on the public internet.")
            headers = {"User-Agent": "Mozilla/5.0 (compatible; chat-assistant)"}
            async with client.stream("GET", current, headers=headers) as res:
                if res.is_redirect and res.headers.get("location"):
                    current = urljoin(current, res.headers["location"])
                    continue
                res.raise_for_status()
                body = bytearray()
                async for chunk in res.aiter_bytes():
                    body += chunk
                    if len(body) > max_bytes:
                        raise WebError(f"That file is over {max_bytes // 1_000_000} MB.")
                return Fetched(current, res.headers.get("content-type", ""), bytes(body))
    raise WebError("Too many redirects.")


async def _direct_fetch(url: str) -> str:
    res = await public_get(url)
    soup = BeautifulSoup(res.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "noscript", "svg"]):
        tag.decompose()
    return "\n".join(line.strip() for line in soup.get_text("\n").splitlines() if line.strip())


def clip(text: str, limit: int = MAX_PAGE_CHARS) -> str:
    return text if len(text) <= limit else text[:limit] + f"\n\n… (cut at {limit} characters)"
