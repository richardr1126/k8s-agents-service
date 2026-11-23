"""Read-only access to the owner's public GitHub repositories."""

from __future__ import annotations

import base64
import re
from typing import Any

import httpx

from core import settings

API = "https://api.github.com"
_REPO_NAME = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
MAX_TEXT = 15_000


class GitHubError(RuntimeError):
    pass


def _owner() -> str:
    return settings.GITHUB_OWNER


def _client() -> httpx.AsyncClient:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if settings.GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {settings.GITHUB_TOKEN.get_secret_value()}"
    return httpx.AsyncClient(base_url=API, headers=headers, timeout=20)


async def _get(client: httpx.AsyncClient, path: str, **params: Any) -> Any:
    res = await client.get(path, params=params or None)
    if res.status_code == 404:
        raise GitHubError(f"Not found on GitHub: {path}")
    if res.status_code in (403, 429):
        raise GitHubError("GitHub's rate limit was hit; try again in a few minutes.")
    res.raise_for_status()
    return res.json()


def _clip(text: str, limit: int = MAX_TEXT) -> str:
    return text if len(text) <= limit else text[:limit] + f"\n\n… (cut at {limit} characters)"


async def _public_repo(client: httpx.AsyncClient, repo: str) -> dict[str, Any]:
    """The repo's metadata, refusing anything that isn't the owner's and public."""
    name = repo.split("/")[-1].strip()
    if not _REPO_NAME.match(name):
        raise GitHubError(f"Not a repository name: {repo!r}")
    if "/" in repo and repo.split("/")[0].lower() != _owner().lower():
        raise GitHubError(f"Only {_owner()}'s repositories are available.")
    data = await _get(client, f"/repos/{_owner()}/{name}")
    if data.get("private") or data.get("visibility", "public") != "public":
        raise GitHubError(f"Not found on GitHub: {name}")
    return data


async def repos(limit: int = 20, sort: str = "pushed") -> str:
    async with _client() as client:
        data = await _get(
            client, f"/users/{_owner()}/repos", type="owner", sort=sort, per_page=min(limit, 100)
        )
    rows = [r for r in data if not r.get("private")][:limit]
    if not rows:
        return "No public repositories."
    lines = [f"Public repositories of {_owner()} ({len(rows)} shown, sorted by {sort}):"]
    for r in rows:
        bits = [
            r.get("language") or "—",
            f"★{r.get('stargazers_count', 0)}",
            f"pushed {r['pushed_at'][:10]}",
        ]
        if r.get("fork"):
            bits.append("fork")
        desc = r.get("description") or ""
        topics = ", ".join(r.get("topics") or [])
        lines.append(
            f"- **{r['name']}** ({'; '.join(bits)}) {desc}"
            + (f" [topics: {topics}]" if topics else "")
            + f" <{r['html_url']}>"
        )
    return "\n".join(lines)


async def readme(repo: str) -> str:
    async with _client() as client:
        meta = await _public_repo(client, repo)
        data = await _get(client, f"/repos/{_owner()}/{meta['name']}/readme")
    text = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
    return f"README of {meta['full_name']} <{meta['html_url']}>\n\n{_clip(text)}"


async def commits(repo: str, limit: int = 10) -> str:
    async with _client() as client:
        meta = await _public_repo(client, repo)
        data = await _get(
            client, f"/repos/{_owner()}/{meta['name']}/commits", per_page=min(limit, 50)
        )
    lines = [f"Latest commits on {meta['full_name']} ({meta['default_branch']}):"]
    for c in data[:limit]:
        message = c["commit"]["message"].splitlines()[0]
        lines.append(
            f"- {c['commit']['author']['date'][:10]} `{c['sha'][:7]}` {message} <{c['html_url']}>"
        )
    return "\n".join(lines)


async def file(repo: str, path: str) -> str:
    clean = path.strip().lstrip("/")
    if ".." in clean.split("/"):
        raise GitHubError("Invalid path.")
    async with _client() as client:
        meta = await _public_repo(client, repo)
        data = await _get(client, f"/repos/{_owner()}/{meta['name']}/contents/{clean}")
    if isinstance(data, list):
        entries = "\n".join(f"- {e['type']}: {e['path']}" for e in data)
        return f"{clean or '/'} in {meta['full_name']} is a folder:\n{entries}"
    if data.get("encoding") != "base64":
        raise GitHubError("That file can't be shown as text.")
    text = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
    return f"{meta['full_name']}/{clean} <{data['html_url']}>\n\n```\n{_clip(text)}\n```"


async def search_code(query: str, repo: str | None = None, limit: int = 10) -> str:
    if not settings.GITHUB_TOKEN:
        raise GitHubError("Code search needs GITHUB_TOKEN on the server.")
    async with _client() as client:
        scope = (
            f"repo:{_owner()}/{(await _public_repo(client, repo))['name']}"
            if repo
            else f"user:{_owner()}"
        )
        data = await _get(client, "/search/code", q=f"{query} {scope}", per_page=min(limit, 30))
    items = [i for i in data.get("items", []) if not i["repository"].get("private")][:limit]
    if not items:
        return f"No code matches for {query!r}."
    return "\n".join(
        [f"Code matches for {query!r}:"]
        + [f"- {i['repository']['name']}/{i['path']} <{i['html_url']}>" for i in items]
    )
