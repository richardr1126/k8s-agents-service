"""`agent` runs a sub-agent. The main assistant turns the command into a `task` call
before it runs (see agents.assistant.commands), so this only answers when it is
called from somewhere that can't start sub-agents."""


async def main(brief: str, type: str | None = None, thread: str | None = None) -> str:
    return "Sub-agents can't start sub-agents. Do the work yourself."
