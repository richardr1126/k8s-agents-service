import os
from unittest.mock import patch

import pytest
from langchain_anthropic import ChatAnthropic
from langchain_community.chat_models import FakeListChatModel
from langchain_groq import ChatGroq
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI
from langchain_openrouter import ChatOpenRouter

from core.llm import get_model
from schema.models import (
    AnthropicModelName,
    FakeModelName,
    GroqModelName,
    OllamaModelName,
    OpenAIModelName,
    OpenRouterModelName,
)


def test_get_model_openai():
    with patch.dict(os.environ, {"OPENAI_API_KEY": "test_key"}):
        model = get_model(OpenAIModelName.GPT_4O_MINI)
        assert isinstance(model, ChatOpenAI)
        assert model.model_name == OpenAIModelName.GPT_4O_MINI.value
        assert model.temperature == 0.5
        assert model.streaming is True
        assert getattr(model, "reasoning", None) == {"effort": "high", "summary": "auto"}


def test_get_model_anthropic():
    with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test_key"}):
        model = get_model(AnthropicModelName.HAIKU_3)
        assert isinstance(model, ChatAnthropic)
        assert model.model == "claude-3-haiku"
        assert model.temperature == 0.5
        assert model.streaming is True
        assert getattr(model, "thinking", None) == {"type": "enabled", "budget_tokens": 10000}


def test_get_model_groq():
    with patch.dict(os.environ, {"GROQ_API_KEY": "test_key"}):
        model = get_model(GroqModelName.LLAMA_31_8B)
        assert isinstance(model, ChatGroq)
        assert model.model_name == "llama-3.1-8b"
        assert model.temperature == 0.5


def test_get_model_groq_guard():
    with patch.dict(os.environ, {"GROQ_API_KEY": "test_key"}):
        model = get_model(GroqModelName.LLAMA_GUARD_4_12B)
        assert isinstance(model, ChatGroq)
        assert model.model_name == "meta-llama/llama-guard-4-12b"
        assert model.temperature < 0.01


def test_get_model_ollama():
    with patch("core.settings.settings.OLLAMA_MODEL", "llama3.3"):
        model = get_model(OllamaModelName.OLLAMA_GENERIC)
        assert isinstance(model, ChatOllama)
        assert model.model == "llama3.3"
        assert model.temperature == 0.5


def test_get_model_fake():
    model = get_model(FakeModelName.FAKE)
    assert isinstance(model, FakeListChatModel)
    assert model.responses == ["This is a test response from the fake model."]


def test_get_model_openrouter_non_anthropic_uses_chat_openrouter():
    with patch.dict(os.environ, {"OPENROUTER_API_KEY": "test_key"}):
        model = get_model(OpenRouterModelName.GPT_54_MINI)
        assert isinstance(model, ChatOpenRouter)
        assert model.model_name == OpenRouterModelName.GPT_54_MINI.value
        assert model.streaming is True
        assert model.openrouter_api_base == "https://openrouter.ai/api/v1"


def test_get_model_openrouter_anthropic_prefix_uses_chat_anthropic():
    with patch.dict(os.environ, {"OPENROUTER_API_KEY": "test_key"}):
        model = get_model(OpenRouterModelName.CLAUDE_HAIKU_45)
        assert isinstance(model, ChatAnthropic)
        assert model.model == OpenRouterModelName.CLAUDE_HAIKU_45.value
        assert model.streaming is True
        assert model.thinking == {"type": "enabled", "budget_tokens": 10000}
        assert model.anthropic_api_url == "https://openrouter.ai/api"


def test_get_model_invalid():
    with pytest.raises(ValueError, match="Unsupported model:"):
        # Using type: ignore since we're intentionally testing invalid input
        get_model("invalid_model")  # type: ignore
