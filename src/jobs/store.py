"""Where background jobs are recorded: a Postgres table, or memory when there's no Postgres."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Protocol

Status = Literal["running", "done", "error"]


@dataclass
class Job:
    id: str
    user_id: str
    thread_id: str | None
    # What runs: a workflow id such as "papers.podcast", or a tool's name.
    workflow: str
    args: dict[str, Any]
    status: Status = "running"
    progress: str = "Starting"
    result: str | None = None
    error: str | None = None
    # Structured output for the UI, e.g. {"audio": {...}} for a podcast.
    data: dict[str, Any] = field(default_factory=dict)
    # Set once the job's end has been told to the agent in its thread.
    notified: bool = False
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
    async def save_file(self, job_id: str, name: str, content_type: str, data: bytes) -> None: ...
    async def get_file(self, job_id: str, name: str) -> tuple[str, bytes] | None: ...
    async def unnotified(self, user_id: str, thread_id: str) -> list[Job]: ...
    async def mark_notified(self, job_ids: list[str]) -> None: ...
    async def touch(self, job_ids: list[str]) -> None: ...
    async def claim_stale(self, stale_seconds: float) -> list[Job]: ...
    async def delete(
        self, *, thread_id: str | None = None, user_id: str | None = None
    ) -> list[str]: ...
    async def move(self, from_user: str, to_user: str) -> int: ...


class MemoryJobStore:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self.files: dict[tuple[str, str], tuple[str, bytes]] = {}

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

    async def save_file(self, job_id: str, name: str, content_type: str, data: bytes) -> None:
        self.files[(job_id, name)] = (content_type, data)

    async def get_file(self, job_id: str, name: str) -> tuple[str, bytes] | None:
        return self.files.get((job_id, name))

    async def unnotified(self, user_id: str, thread_id: str) -> list[Job]:
        return sorted(
            (
                j
                for j in self.jobs.values()
                if j.user_id == user_id
                and j.thread_id == thread_id
                and j.status != "running"
                and not j.notified
            ),
            key=lambda j: j.updated_at,
        )

    async def mark_notified(self, job_ids: list[str]) -> None:
        for job_id in job_ids:
            if job := self.jobs.get(job_id):
                job.notified = True

    async def touch(self, job_ids: list[str]) -> None:
        for job_id in job_ids:
            if job := self.jobs.get(job_id):
                job.updated_at = datetime.now(UTC)

    async def claim_stale(self, stale_seconds: float) -> list[Job]:
        cutoff = datetime.now(UTC) - timedelta(seconds=stale_seconds)
        claimed = [j for j in self.jobs.values() if j.status == "running" and j.updated_at < cutoff]
        await self.touch([j.id for j in claimed])
        return claimed

    async def delete(
        self, *, thread_id: str | None = None, user_id: str | None = None
    ) -> list[str]:
        gone = [
            j.id
            for j in self.jobs.values()
            if (thread_id is not None and j.thread_id == thread_id)
            or (user_id is not None and j.user_id == user_id)
        ]
        for job_id in gone:
            del self.jobs[job_id]
        self.files = {k: v for k, v in self.files.items() if k[0] not in gone}
        return gone

    async def move(self, from_user: str, to_user: str) -> int:
        moved = [j for j in self.jobs.values() if j.user_id == from_user]
        for job in moved:
            job.user_id = to_user
        return len(moved)


_COLUMNS = (
    "id, user_id, thread_id, workflow, args, status, progress, result, error, data, "
    "notified, created_at, updated_at"
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
                    notified boolean NOT NULL DEFAULT false,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            # Jobs from before job events count as told, so old threads get no late notices.
            await conn.execute(
                "ALTER TABLE assistant_jobs ADD COLUMN IF NOT EXISTS "
                "notified boolean NOT NULL DEFAULT true"
            )
            await conn.execute("ALTER TABLE assistant_jobs ALTER COLUMN notified SET DEFAULT false")
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS assistant_jobs_user ON assistant_jobs (user_id, status)"
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS assistant_jobs_unnotified ON assistant_jobs "
                "(thread_id) WHERE NOT notified AND status <> 'running'"
            )
            # What a job produced that doesn't fit in `data`, such as a podcast's audio.
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS assistant_job_files (
                    job_id text NOT NULL REFERENCES assistant_jobs (id) ON DELETE CASCADE,
                    name text NOT NULL,
                    content_type text NOT NULL,
                    data bytea NOT NULL,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (job_id, name)
                )
                """
            )
            # Running jobs whose process died are found by their stale heartbeat
            # (`claim_stale`), resumed if they can be, and otherwise marked stopped.

    async def create(self, job: Job) -> None:
        values = job.public()
        async with self.pool.connection() as conn:
            await conn.execute(
                f"INSERT INTO assistant_jobs ({_COLUMNS}) VALUES "
                "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
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

    async def save_file(self, job_id: str, name: str, content_type: str, data: bytes) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO assistant_job_files (job_id, name, content_type, data) "
                "VALUES (%s, %s, %s, %s) ON CONFLICT (job_id, name) DO UPDATE "
                "SET content_type = EXCLUDED.content_type, data = EXCLUDED.data",
                [job_id, name, content_type, data],
            )

    async def get_file(self, job_id: str, name: str) -> tuple[str, bytes] | None:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT content_type, data FROM assistant_job_files WHERE job_id = %s AND name = %s",
                [job_id, name],
            )
            row = await cur.fetchone()
        return (row["content_type"], bytes(row["data"])) if row else None

    async def unnotified(self, user_id: str, thread_id: str) -> list[Job]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                f"SELECT {_COLUMNS} FROM assistant_jobs WHERE thread_id = %s AND user_id = %s "
                "AND NOT notified AND status <> 'running' ORDER BY updated_at",
                [thread_id, user_id],
            )
            rows = await cur.fetchall()
        return [Job(**row) for row in rows]

    async def mark_notified(self, job_ids: list[str]) -> None:
        if not job_ids:
            return
        async with self.pool.connection() as conn:
            await conn.execute(
                "UPDATE assistant_jobs SET notified = true WHERE id = ANY(%s)", [job_ids]
            )

    async def touch(self, job_ids: list[str]) -> None:
        """The heartbeat: marks these jobs as still owned by a live process."""
        if not job_ids:
            return
        async with self.pool.connection() as conn:
            await conn.execute(
                "UPDATE assistant_jobs SET updated_at = now() "
                "WHERE id = ANY(%s) AND status = 'running'",
                [job_ids],
            )

    async def claim_stale(self, stale_seconds: float) -> list[Job]:
        """Running jobs with no heartbeat for `stale_seconds`, claimed for this process.

        The claim bumps their heartbeat in the same statement, so when several
        processes sweep at once each job goes to exactly one of them.
        """
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                f"UPDATE assistant_jobs SET updated_at = now() WHERE id IN ("
                "SELECT id FROM assistant_jobs WHERE status = 'running' "
                "AND updated_at < now() - make_interval(secs => %s) FOR UPDATE SKIP LOCKED"
                f") RETURNING {_COLUMNS}",
                [stale_seconds],
            )
            rows = await cur.fetchall()
        return [Job(**row) for row in rows]

    async def delete(
        self, *, thread_id: str | None = None, user_id: str | None = None
    ) -> list[str]:
        """Deletes a conversation's or a user's jobs, their files with them; returns their ids."""
        if thread_id is None and user_id is None:
            return []
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "DELETE FROM assistant_jobs WHERE thread_id = %s OR user_id = %s RETURNING id",
                [thread_id, user_id],
            )
            rows = await cur.fetchall()
        return [row["id"] for row in rows]

    async def move(self, from_user: str, to_user: str) -> int:
        """Gives one user's jobs to another, as when a guest signs up."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "UPDATE assistant_jobs SET user_id = %s WHERE user_id = %s", [to_user, from_user]
            )
        return cur.rowcount
