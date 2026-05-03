"""Shared compaction and low-step tool-call policy helpers for agent tool loops."""

from dataclasses import dataclass
import hashlib
import json
from typing import Any, cast

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig

from core import settings
from service.utils import convert_message_content_to_string

COMPACTION_SUMMARY_SYSTEM_PROMPT = (
    "You are a conversation compaction assistant. Merge the existing rolling summary and the "
    "older conversation chunk into a concise, high-fidelity summary that preserves user intent, "
    "facts, constraints, decisions, and unresolved questions. Do not invent details."
)

COMPACTION_SUMMARY_USER_TEMPLATE = """\
Existing summary (may be empty):
{existing_summary}

Older conversation chunk to compact:
{source_text}

Return only the updated rolling summary.
"""

FINALIZE_WITHOUT_TOOLS_HINT = (
    "For this response, provide the best possible final answer from available context only. "
    "Do not call tools."
)


@dataclass(frozen=True)
class CompactionConfig:
    enabled_default: bool = settings.AGENT_COMPACTION_ENABLED
    trigger_tokens_default: int = settings.AGENT_COMPACTION_TRIGGER_TOKENS
    trigger_chars_fallback_default: int = settings.AGENT_COMPACTION_CHAR_TRIGGER_FALLBACK
    summary_state_key: str = "compaction_summary"
    last_anchor_signature_state_key: str = "compaction_last_anchor_signature"
    enabled_config_key: str = "compaction_enabled"
    trigger_tokens_config_key: str = "compaction_trigger_tokens"
    trigger_chars_fallback_config_key: str = "compaction_char_trigger_fallback"
    low_step_guard_enabled_default: bool = settings.AGENT_LOW_STEP_GUARD_ENABLED
    low_step_guard_enabled_config_key: str = "low_step_guard_enabled"
    min_remaining_steps_config_key: str = "min_remaining_steps_for_tool_calls"
    min_remaining_steps_default: int = settings.AGENT_MIN_REMAINING_STEPS_FOR_TOOL_CALLS


@dataclass
class CompactionOutcome:
    invoke_state: dict[str, Any]
    updated_summary: str | None
    anchor_signature: str | None


@dataclass
class ToolCallResolution:
    response: AIMessage
    updated_summary: str | None
    anchor_signature: str | None


def prompt_with_compaction_summary(base_prompt: str, state: dict[str, Any]) -> str:
    summary = state.get("compaction_summary")
    if not isinstance(summary, str):
        return base_prompt
    normalized_summary = summary.strip()
    if not normalized_summary:
        return base_prompt
    return f"{base_prompt}\n\nCompacted Conversation Summary:\n{normalized_summary}\n"


def build_model_update(
    *,
    response: AIMessage,
    updated_summary: str | None,
    anchor_signature: str | None,
) -> dict[str, Any]:
    update: dict[str, Any] = {"messages": [response]}
    if updated_summary is not None:
        update["compaction_summary"] = updated_summary
    if anchor_signature is not None:
        update["compaction_last_anchor_signature"] = anchor_signature
    return update


class CompactionManager:
    """Compacts message history and resolves low-step tool-call behavior."""

    def __init__(self, config: CompactionConfig | None = None) -> None:
        self._config = config or CompactionConfig()

    async def maybe_compact(
        self, *, summary_model: Any, state: dict[str, Any], config: RunnableConfig
    ) -> CompactionOutcome:
        if not self._configurable_bool(
            config, self._config.enabled_config_key, self._config.enabled_default
        ):
            return CompactionOutcome(invoke_state=state, updated_summary=None, anchor_signature=None)
        messages = state.get("messages")
        if not isinstance(messages, list):
            return CompactionOutcome(invoke_state=state, updated_summary=None, anchor_signature=None)

        last_ai = self._last_ai(messages)
        if last_ai is None:
            return CompactionOutcome(invoke_state=state, updated_summary=None, anchor_signature=None)
        cutoff_idx, anchor_message = last_ai
        anchor_signature = self._message_signature(anchor_message)

        previous_anchor = state.get(self._config.last_anchor_signature_state_key)
        if isinstance(previous_anchor, str) and previous_anchor == anchor_signature:
            return CompactionOutcome(invoke_state=state, updated_summary=None, anchor_signature=None)

        token_total = self._ai_message_total_tokens(anchor_message)
        if token_total is not None:
            threshold = self._configurable_int(
                config,
                self._config.trigger_tokens_config_key,
                self._config.trigger_tokens_default,
            )
            should_compact = threshold > 0 and token_total >= threshold
        else:
            char_count = self._messages_char_count(messages)
            threshold = self._configurable_int(
                config,
                self._config.trigger_chars_fallback_config_key,
                self._config.trigger_chars_fallback_default,
            )
            should_compact = threshold > 0 and char_count >= threshold

        if not should_compact:
            return CompactionOutcome(invoke_state=state, updated_summary=None, anchor_signature=None)
        if cutoff_idx <= 0 or cutoff_idx >= len(messages) - 1:
            return CompactionOutcome(invoke_state=state, updated_summary=None, anchor_signature=None)

        to_compact = messages[:cutoff_idx]
        to_keep = messages[cutoff_idx:]
        if not to_compact:
            return CompactionOutcome(invoke_state=state, updated_summary=None, anchor_signature=None)

        existing_summary = ""
        prior_summary = state.get(self._config.summary_state_key)
        if isinstance(prior_summary, str):
            existing_summary = prior_summary
        source_text = self._render_source_text(to_compact)
        if not source_text:
            return CompactionOutcome(invoke_state=state, updated_summary=None, anchor_signature=None)

        summary_messages: list[BaseMessage] = [
            SystemMessage(content=COMPACTION_SUMMARY_SYSTEM_PROMPT),
            HumanMessage(
                content=COMPACTION_SUMMARY_USER_TEMPLATE.format(
                    existing_summary=existing_summary or "(none)",
                    source_text=source_text,
                )
            ),
        ]
        summary_response = cast(AIMessage, await summary_model.ainvoke(summary_messages, config))
        updated_summary = convert_message_content_to_string(summary_response.content).strip()
        if not updated_summary:
            return CompactionOutcome(invoke_state=state, updated_summary=None, anchor_signature=None)

        invoke_state = {
            **state,
            "messages": to_keep,
            self._config.summary_state_key: updated_summary,
            self._config.last_anchor_signature_state_key: anchor_signature,
        }
        return CompactionOutcome(
            invoke_state=invoke_state,
            updated_summary=updated_summary,
            anchor_signature=anchor_signature,
        )

    async def resolve_low_step_tool_call(
        self,
        *,
        state: dict[str, Any],
        invoke_state: dict[str, Any],
        response: AIMessage,
        config: RunnableConfig,
        model_runnable_without_tools: Any,
        updated_summary: str | None,
        anchor_signature: str | None,
    ) -> ToolCallResolution:
        if not response.tool_calls:
            return ToolCallResolution(response, updated_summary, anchor_signature)
        if not self._configurable_bool(
            config,
            self._config.low_step_guard_enabled_config_key,
            self._config.low_step_guard_enabled_default,
        ):
            return ToolCallResolution(response, updated_summary, anchor_signature)

        remaining_steps = state.get("remaining_steps")
        min_remaining_steps = self._configurable_int(
            config,
            self._config.min_remaining_steps_config_key,
            self._config.min_remaining_steps_default,
        )
        if not isinstance(remaining_steps, int) or remaining_steps >= min_remaining_steps:
            return ToolCallResolution(response, updated_summary, anchor_signature)

        final_invoke_state = self._with_control_hint(invoke_state, FINALIZE_WITHOUT_TOOLS_HINT)
        final_response = await model_runnable_without_tools.ainvoke(final_invoke_state, config)
        if final_response.tool_calls:
            final_response = final_response.model_copy(update={"tool_calls": []})
        return ToolCallResolution(final_response, updated_summary, anchor_signature)

    def _configurable_int(self, config: RunnableConfig, key: str, default: int) -> int:
        configurable = config.get("configurable", {})
        if isinstance(configurable, dict):
            raw_value = configurable.get(key)
            if isinstance(raw_value, int):
                return raw_value
            if isinstance(raw_value, str):
                try:
                    return int(raw_value.strip())
                except ValueError:
                    pass
        return default

    def _configurable_bool(self, config: RunnableConfig, key: str, default: bool) -> bool:
        configurable = config.get("configurable", {})
        if isinstance(configurable, dict):
            raw_value = configurable.get(key)
            if isinstance(raw_value, bool):
                return raw_value
            if isinstance(raw_value, str):
                normalized = raw_value.strip().lower()
                if normalized in {"1", "true", "yes", "on"}:
                    return True
                if normalized in {"0", "false", "no", "off"}:
                    return False
        return default

    @staticmethod
    def _with_control_hint(state: dict[str, Any], hint: str) -> dict[str, Any]:
        messages = state.get("messages")
        if not isinstance(messages, list):
            return state
        return {**state, "messages": [*messages, HumanMessage(content=hint)]}

    @staticmethod
    def _last_ai(messages: list[Any]) -> tuple[int, AIMessage] | None:
        for idx in range(len(messages) - 1, -1, -1):
            message = messages[idx]
            if isinstance(message, AIMessage):
                return idx, message
        return None

    @staticmethod
    def _message_signature(message: BaseMessage) -> str:
        payload = {
            "type": message.__class__.__name__,
            "content": convert_message_content_to_string(getattr(message, "content", "")),
            "tool_calls": getattr(message, "tool_calls", None),
        }
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
        return digest

    @staticmethod
    def _render_source_text(messages: list[BaseMessage]) -> str:
        lines: list[str] = []
        for message in messages:
            role = "assistant"
            if isinstance(message, HumanMessage):
                role = "user"
            content = convert_message_content_to_string(getattr(message, "content", "")).strip()
            if content:
                lines.append(f"{role}: {content}")
        return "\n".join(lines)

    @staticmethod
    def _messages_char_count(messages: list[BaseMessage]) -> int:
        return sum(
            len(convert_message_content_to_string(getattr(message, "content", "")))
            for message in messages
        )

    @staticmethod
    def _normalize_token_int(value: Any) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value if value >= 0 else None
        if isinstance(value, float):
            return int(value) if value >= 0 else None
        return None

    @classmethod
    def _ai_message_total_tokens(cls, message: AIMessage) -> int | None:
        usage = getattr(message, "usage_metadata", None)
        if isinstance(usage, dict):
            for key in ("total_tokens", "total_token_count"):
                value = cls._normalize_token_int(usage.get(key))
                if value is not None:
                    return value

        response_metadata = getattr(message, "response_metadata", None)
        if isinstance(response_metadata, dict):
            for usage_key in ("usage", "usage_metadata"):
                usage_data = response_metadata.get(usage_key)
                if not isinstance(usage_data, dict):
                    continue
                for key in ("total_tokens", "total_token_count"):
                    value = cls._normalize_token_int(usage_data.get(key))
                    if value is not None:
                        return value
        return None
