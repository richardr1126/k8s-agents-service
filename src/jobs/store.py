"""Where background jobs are recorded: a Postgres table, or memory when there's no Postgres."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

Status = Literal["running", "done", "error"]


@dataclass
class Job:
    id: str
    user_id: str
    thread_id: str | None
    workflow: str
    args: dict[str, Any]
    status: Status = "running"
    progress: str = "Starting"
    result: str | None = None
    error: str | None = None
    # Structured output for the UI, e.g. {"audio": {...}} for a podcast.
    data: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def public(self) -> dict[str, Any]:
        out = asdict(self)
        out["created_at"] = self.created_at.isoformat()
        out["updated_at"] = self.updated_at.isoformat()
        return out


class JobStore(Protocol):
    async def setup(self) -> None: ...
    async def create(self, job: Job) -> None: ...
    async def update(self, job_id: str, **fields: Any) -> None: ...
    async def get(self, job_id: str) -> Job | None: ...
    async def running_for(self, user_id: str) -> int: ...


class MemoryJobStore:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}

    async def setup(self) -> None:
        pass

    async def create(self, job: Job) -> None:
        self.jobs[job.id] = job

    async def update(self, job_id: str, **fields: Any) -> None:
        job = self.jobs[job_id]
        for key, value in fields.items():
            setattr(job, key, value)
        job.updated_at = datetime.now(UTC)

    async def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    async def running_for(self, user_id: str) -> int:
        return sum(1 for j in self.jobs.values() if j.user_id == user_id and j.status == "running")


_COLUMNS = (
    "id, user_id, thread_id, workflow, args, status, progress, result, error, data, "
    "created_at, updated_at"
)
_JSON = {"args", "data"}


class PostgresJobStore:
    """Uses the checkpointer's connection pool (autocommit, dict rows)."""

    def __init__(self, pool: Any) -> None:
        self.pool = pool

    async def setup(self) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS assistant_jobs (
                    id text PRIMARY KEY,
                    user_id text NOT NULL,
                    thread_id text,
                    workflow text NOT NULL,
                    args jsonb NOT NULL DEFAULT '{}',
                    status text NOT NULL,
                    progress text NOT NULL DEFAULT '',
                    result text,
                    error text,
                    data jsonb NOT NULL DEFAULT '{}',
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS assistant_jobs_user ON assistant_jobs (user_id, status)"
            )
            # Jobs run in this process; any still marked running died with the last one.
            await conn.execute(
                "UPDATE assistant_jobs SET status = 'error', error = 'Stopped by a server restart.', "
                "updated_at = now() WHERE status = 'running'"
            )

    async def create(self, job: Job) -> None:
        values = job.public()
        async with self.pool.connection() as conn:
            await conn.execute(
                f"INSERT INTO assistant_jobs ({_COLUMNS}) VALUES "
                "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                [json.dumps(values[c]) if c in _JSON else values[c] for c in _COLUMNS.split(", ")],
            )

    async def update(self, job_id: str, **fields: Any) -> None:
        if not fields:
            return
        sets = ", ".join(f"{k} = %s" for k in fields)
        values = [json.dumps(v) if k in _JSON else v for k, v in fields.items()]
        async with self.pool.connection() as conn:
            await conn.execute(
                f"UPDATE assistant_jobs SET {sets}, updated_at = now() WHERE id = %s",
                [*values, job_id],
            )

    async def get(self, job_id: str) -> Job | None:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                f"SELECT {_COLUMNS} FROM assistant_jobs WHERE id = %s", [job_id]
            )
            row = await cur.fetchone()
        return Job(**row) if row else None

    async def running_for(self, user_id: str) -> int:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT count(*) AS n FROM assistant_jobs WHERE user_id = %s AND status = 'running'",
                [user_id],
            )
            row = await cur.fetchone()
        return int(row["n"]) if row else 0
