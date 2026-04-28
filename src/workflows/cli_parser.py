from __future__ import annotations

import shlex
from typing import Any

from workflows.registry import SkillRegistry


def parse_workflow_cli_command(
    command: str, registry: SkillRegistry
) -> tuple[str, dict[str, Any]]:
    original_command = command.strip()
    if not original_command:
        raise ValueError("args validation failure: command must not be empty")

    tokens = _parse_cli_tokens(original_command)
    if not tokens:
        raise ValueError("args validation failure: command must not be empty")

    workflow_id = tokens[0]
    capability = registry.capabilities.get(workflow_id)
    if capability is None:
        available = ", ".join(sorted(registry.capabilities))
        raise ValueError(
            f"args validation failure: unknown workflow_id: {workflow_id}. "
            f"Available workflows: {available}"
        )

    arg_schema = capability.arg_schema if isinstance(capability.arg_schema, dict) else {}

    usage = _workflow_usage(workflow_id, arg_schema)
    flag_aliases = _workflow_flag_aliases(arg_schema)
    positional_args = _workflow_positional_args(arg_schema)
    positional_values: list[str] = []
    parsed_args: dict[str, Any] = {}

    index = 1
    positional_only = False
    while index < len(tokens):
        token = tokens[index]
        if token == "--" and not positional_only:
            positional_only = True
            index += 1
            continue

        if not positional_only and token.startswith("--"):
            long_flag, equals, inline_value = token.partition("=")
            arg_name = flag_aliases.get(long_flag)
            if arg_name is None:
                raise ValueError(
                    f"args validation failure: unknown flag `{long_flag}`. {usage}"
                )
            if arg_name in parsed_args:
                raise ValueError(
                    f"args validation failure: duplicate flag `{long_flag}`. {usage}"
                )

            schema = arg_schema.get(arg_name)
            if not isinstance(schema, dict):
                schema = {"type": "string"}

            if equals:
                parsed_args[arg_name] = _coerce_cli_arg_value(
                    arg_name, inline_value, schema, usage
                )
                index += 1
                continue

            if _schema_is_boolean(schema):
                if index + 1 < len(tokens):
                    value_token = tokens[index + 1]
                    if _is_boolean_literal_token(value_token):
                        parsed_args[arg_name] = _coerce_cli_arg_value(
                            arg_name, value_token, schema, usage
                        )
                        index += 2
                        continue
                parsed_args[arg_name] = True
                index += 1
                continue

            if index + 1 >= len(tokens):
                raise ValueError(
                    f"args validation failure: missing value for `{long_flag}`. {usage}"
                )
            value_token = tokens[index + 1]
            if _looks_like_flag_token(value_token, flag_aliases):
                raise ValueError(
                    f"args validation failure: missing value for `{long_flag}`. {usage}"
                )
            parsed_args[arg_name] = _coerce_cli_arg_value(arg_name, value_token, schema, usage)
            index += 2
            continue

        if not positional_only and token.startswith("-") and token != "-":
            index = _consume_short_flags(
                tokens=tokens,
                start_index=index,
                flag_aliases=flag_aliases,
                arg_schema=arg_schema,
                parsed_args=parsed_args,
                usage=usage,
            )
            continue

        positional_values.append(token)
        index += 1

    for positional_index, value in enumerate(positional_values, start=1):
        if positional_index > len(positional_args):
            hint = _escaped_quotes_hint(tokens=tokens, command=original_command)
            if hint:
                raise ValueError(
                    f"args validation failure: unexpected positional argument `{value}`. "
                    f"{usage} {hint}"
                )
            raise ValueError(
                f"args validation failure: unexpected positional argument `{value}`. {usage}"
            )

        arg_name = positional_args[positional_index - 1]
        if arg_name in parsed_args:
            raise ValueError(
                f"args validation failure: duplicate argument `{arg_name}`. {usage}"
            )

        schema = arg_schema.get(arg_name)
        if not isinstance(schema, dict):
            schema = {"type": "string"}
        parsed_args[arg_name] = _coerce_cli_arg_value(arg_name, value, schema, usage)

    for arg_name, schema in arg_schema.items():
        if arg_name in parsed_args:
            continue
        if not isinstance(schema, dict) or "default" not in schema:
            continue
        parsed_args[arg_name] = _coerce_cli_arg_value(
            arg_name, schema["default"], schema, usage
        )

    missing = [
        arg_name
        for arg_name, schema in arg_schema.items()
        if isinstance(schema, dict) and schema.get("required") and arg_name not in parsed_args
    ]
    if missing:
        missing_flags = ", ".join(f"--{arg_name.replace('_', '-')}" for arg_name in missing)
        raise ValueError(
            f"args validation failure: missing required flags: {missing_flags}. {usage}"
        )

    return workflow_id, parsed_args


def _parse_cli_tokens(command: str) -> list[str]:
    try:
        tokens = shlex.split(command, posix=True)
    except ValueError as exc:
        normalized = _normalize_over_escaped_quotes(command)
        if normalized != command:
            try:
                return shlex.split(normalized, posix=True)
            except ValueError:
                pass
            hint = (
                " Hint: over-escaped quotes (`\\\"`) can break CLI parsing. "
                "Use plain quotes."
            )
            raise ValueError(
                f"args validation failure: invalid command: {exc}.{hint}"
            ) from exc
        raise ValueError(f"args validation failure: invalid command: {exc}") from exc

    if _looks_like_over_escaped_quote_issue(tokens=tokens, command=command):
        normalized = _normalize_over_escaped_quotes(command)
        if normalized != command:
            try:
                return shlex.split(normalized, posix=True)
            except ValueError:
                pass

    return tokens


def _normalize_over_escaped_quotes(command: str) -> str:
    return command.replace('\\"', '"')


def _looks_like_over_escaped_quote_issue(tokens: list[str], command: str) -> bool:
    if '\\"' not in command:
        return False
    return any(
        not token.startswith("--") and (token.startswith('"') or token.endswith('"'))
        for token in tokens[1:]
    )


def _escaped_quotes_hint(tokens: list[str], command: str) -> str | None:
    if not _looks_like_over_escaped_quote_issue(tokens=tokens, command=command):
        return None
    return (
        "Hint: value appears split by over-escaped quotes (`\\\"`). Use plain quotes."
    )


def _workflow_flag_aliases(arg_schema: dict[str, Any]) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for arg_name, raw_schema in arg_schema.items():
        if not isinstance(arg_name, str):
            continue
        schema = raw_schema if isinstance(raw_schema, dict) else {}
        for alias in [f"--{arg_name}", f"--{arg_name.replace('_', '-')}"]:
            _set_flag_alias(aliases, alias=alias, arg_name=arg_name)
        custom_aliases = schema.get("aliases")
        if isinstance(custom_aliases, list):
            for item in custom_aliases:
                normalized_alias = _normalize_flag_alias(item)
                if not normalized_alias:
                    continue
                _set_flag_alias(aliases, alias=normalized_alias, arg_name=arg_name)
    return aliases


def _workflow_usage(workflow_id: str, arg_schema: dict[str, Any]) -> str:
    parts: list[str] = []
    positional_names = set(_workflow_positional_args(arg_schema))
    for arg_name in _workflow_positional_args(arg_schema):
        schema = arg_schema.get(arg_name)
        is_required = isinstance(schema, dict) and bool(schema.get("required"))
        value_fragment = f"<{arg_name}>"
        parts.append(value_fragment if is_required else f"[{value_fragment}]")

    for arg_name, schema in arg_schema.items():
        if not isinstance(arg_name, str):
            continue
        if arg_name in positional_names:
            continue
        flag = f"--{arg_name.replace('_', '-')}"
        is_required = isinstance(schema, dict) and bool(schema.get("required"))
        fragment = f"{flag} <value>" if is_required else f"[{flag} <value>]"
        parts.append(fragment)
    suffix = f" {' '.join(parts)}" if parts else ""
    return f"Usage: {workflow_id}{suffix}"


def _workflow_positional_args(arg_schema: dict[str, Any]) -> list[str]:
    entries: list[tuple[int, str]] = []
    for arg_name, raw_schema in arg_schema.items():
        if not isinstance(arg_name, str) or not isinstance(raw_schema, dict):
            continue
        raw_position = raw_schema.get("position")
        if raw_position is None:
            continue
        try:
            position = int(raw_position)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"args validation failure: invalid `position` for arg `{arg_name}`: "
                f"{raw_position!r}"
            ) from exc
        if position <= 0:
            raise ValueError(
                f"args validation failure: invalid `position` for arg `{arg_name}`: "
                f"{raw_position!r}"
            )
        entries.append((position, arg_name))
    entries.sort(key=lambda item: (item[0], item[1]))

    seen_positions: set[int] = set()
    ordered: list[str] = []
    for position, arg_name in entries:
        if position in seen_positions:
            raise ValueError(
                f"args validation failure: duplicate positional index `{position}` in arg_schema"
            )
        seen_positions.add(position)
        ordered.append(arg_name)
    return ordered


def _normalize_flag_alias(value: Any) -> str:
    alias = str(value or "").strip()
    if not alias:
        return ""
    if alias == "--":
        raise ValueError("args validation failure: `--` is not a valid alias")
    if alias.startswith("--"):
        return alias
    if alias.startswith("-"):
        if len(alias) != 2:
            raise ValueError(f"args validation failure: invalid short alias `{alias}`")
        return alias
    if len(alias) == 1:
        return f"-{alias}"
    return f"--{alias.replace('_', '-')}"


def _set_flag_alias(aliases: dict[str, str], *, alias: str, arg_name: str) -> None:
    existing = aliases.get(alias)
    if existing and existing != arg_name:
        raise ValueError(
            f"args validation failure: alias collision for `{alias}` between "
            f"`{existing}` and `{arg_name}`"
        )
    aliases[alias] = arg_name


def _schema_is_boolean(schema: dict[str, Any]) -> bool:
    return str(schema.get("type", "")).strip().lower() == "boolean"


def _looks_like_flag_token(token: str, flag_aliases: dict[str, str]) -> bool:
    if token == "--":
        return True
    if token in flag_aliases:
        return True
    if token.startswith("--"):
        long_flag = token.split("=", maxsplit=1)[0]
        return long_flag in flag_aliases
    if token.startswith("-") and token != "-":
        short_flag = f"-{token[1]}"
        return short_flag in flag_aliases
    return False


def _is_boolean_literal_token(token: str) -> bool:
    return str(token).strip().lower() in {"true", "1", "yes", "on", "false", "0", "no", "off"}


def _consume_short_flags(
    *,
    tokens: list[str],
    start_index: int,
    flag_aliases: dict[str, str],
    arg_schema: dict[str, Any],
    parsed_args: dict[str, Any],
    usage: str,
) -> int:
    token = tokens[start_index]
    if len(token) < 2:
        raise ValueError(f"args validation failure: unknown flag `{token}`. {usage}")
    short_bundle = token[1:]
    cursor = 0
    while cursor < len(short_bundle):
        flag = f"-{short_bundle[cursor]}"
        arg_name = flag_aliases.get(flag)
        if arg_name is None:
            raise ValueError(f"args validation failure: unknown flag `{flag}`. {usage}")
        if arg_name in parsed_args:
            raise ValueError(f"args validation failure: duplicate flag `{flag}`. {usage}")

        schema = arg_schema.get(arg_name)
        if not isinstance(schema, dict):
            schema = {"type": "string"}

        if _schema_is_boolean(schema):
            parsed_args[arg_name] = True
            cursor += 1
            continue

        remainder = short_bundle[cursor + 1 :]
        if remainder:
            parsed_args[arg_name] = _coerce_cli_arg_value(arg_name, remainder, schema, usage)
            return start_index + 1

        value_index = start_index + 1
        if value_index >= len(tokens):
            raise ValueError(f"args validation failure: missing value for `{flag}`. {usage}")
        value_token = tokens[value_index]
        if _looks_like_flag_token(value_token, flag_aliases):
            raise ValueError(f"args validation failure: missing value for `{flag}`. {usage}")
        parsed_args[arg_name] = _coerce_cli_arg_value(arg_name, value_token, schema, usage)
        return start_index + 2

    return start_index + 1


def _coerce_cli_arg_value(
    arg_name: str, raw_value: Any, schema: dict[str, Any], usage: str
) -> Any:
    arg_type = str(schema.get("type", "string")).strip().lower()
    if arg_type == "string":
        return str(raw_value)
    if arg_type == "integer":
        try:
            value = int(raw_value)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"args validation failure: invalid integer for "
                f"`--{arg_name.replace('_', '-')}`: {raw_value!r}. {usage}"
            ) from exc
        minimum = _coerce_integer_bound(schema.get("minimum"))
        if minimum is not None and value < minimum:
            raise ValueError(
                f"args validation failure: `--{arg_name.replace('_', '-')}` must be "
                f">= {minimum}: {value!r}. {usage}"
            )
        maximum = _coerce_integer_bound(schema.get("maximum"))
        if maximum is not None and value > maximum:
            raise ValueError(
                f"args validation failure: `--{arg_name.replace('_', '-')}` must be "
                f"<= {maximum}: {value!r}. {usage}"
            )
        return value
    if arg_type == "number":
        try:
            return float(raw_value)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"args validation failure: invalid number for "
                f"`--{arg_name.replace('_', '-')}`: {raw_value!r}. {usage}"
            ) from exc
    if arg_type == "boolean":
        bool_text = str(raw_value).strip().lower()
        if bool_text in {"true", "1", "yes", "on"}:
            return True
        if bool_text in {"false", "0", "no", "off"}:
            return False
        raise ValueError(
            f"args validation failure: invalid boolean for "
            f"`--{arg_name.replace('_', '-')}`: {raw_value!r}. {usage}"
        )
    raise ValueError(
        f"args validation failure: unsupported arg type `{arg_type}` for "
        f"`--{arg_name.replace('_', '-')}`. {usage}"
    )


def _coerce_integer_bound(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
