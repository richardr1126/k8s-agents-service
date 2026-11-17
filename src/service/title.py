"""Name a conversation from its first message with a small, cheap model."""

from langchain_openrouter import ChatOpenRouter
from pydantic import BaseModel, Field

from core import settings

_PROMPT = (
    "Write a short title for a chat that starts with the user message below. "
    "Use 2 to 6 words in title case, no quotes, no trailing punctuation, "
    "and the user's language. Describe the topic; don't answer the message.\n\n"
    "User message:\n{text}"
)


class ThreadTitle(BaseModel):
    title: str = Field(description="2 to 6 word title for the conversation")


def _model() -> ChatOpenRouter:
    return ChatOpenRouter(
        model=settings.TITLE_MODEL,
        temperature=0,
        max_tokens=40,
        base_url=settings.OPENROUTER_BASE_URL,
        api_key=settings.OPENROUTER_API_KEY,
    )


async def generate_title(text: str) -> str:
    structured = _model().with_structured_output(ThreadTitle, method="json_schema")
    result = await structured.ainvoke(_PROMPT.format(text=text[:2000]))
    title = ThreadTitle.model_validate(result).title.strip().strip("\"'").rstrip(".")
    return " ".join(title.split())[:80]
