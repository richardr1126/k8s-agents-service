from functools import cache
from typing import TypeAlias

from langchain_anthropic import ChatAnthropic
from langchain_aws import ChatBedrock
from langchain_community.chat_models import FakeListChatModel
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_groq import ChatGroq
from langchain_ollama import ChatOllama
from langchain_openai import AzureChatOpenAI, ChatOpenAI
from langchain_openrouter import ChatOpenRouter

from core.settings import settings
from schema.models import (
    AllModelEnum,
    AnthropicModelName,
    AWSModelName,
    AzureOpenAIModelName,
    DeepseekModelName,
    FakeModelName,
    GoogleModelName,
    GroqModelName,
    OllamaModelName,
    OpenAICompatibleName,
    OpenAIModelName,
    OpenRouterModelName,
)

_MODEL_TABLE = (
    {m: m.value for m in OpenAIModelName}
    | {m: m.value for m in OpenAICompatibleName}
    | {m: m.value for m in AzureOpenAIModelName}
    | {m: m.value for m in DeepseekModelName}
    | {m: m.value for m in AnthropicModelName}
    | {m: m.value for m in GoogleModelName}
    | {m: m.value for m in GroqModelName}
    | {m: m.value for m in AWSModelName}
    | {m: m.value for m in OllamaModelName}
    | {m: m.value for m in OpenRouterModelName}
    | {m: m.value for m in FakeModelName}
)


class FakeToolModel(FakeListChatModel):
    def __init__(self, responses: list[str]):
        super().__init__(responses=responses)

    def bind_tools(self, tools):
        return self


ModelT: TypeAlias = (
    AzureChatOpenAI
    | ChatOpenAI
    | ChatAnthropic
    | ChatGoogleGenerativeAI
    | ChatGroq
    | ChatBedrock
    | ChatOllama
    | ChatOpenRouter
    | FakeToolModel
)

_OPENAI_REASONING_KWARGS = {
    "reasoning": {"effort": "high", "summary": "auto"},
}
_ANTHROPIC_THINKING_KWARGS = {"thinking": {"type": "enabled", "budget_tokens": 10000}}
_GOOGLE_THINKING_KWARGS = {"include_thoughts": True, "thinking_budget": -1}


def _openrouter_anthropic_base_url() -> str:
    base = settings.OPENROUTER_BASE_URL.rstrip("/")
    if base.endswith("/v1"):
        return base[: -len("/v1")]
    return base


def _supported_model_kwargs(model_cls: type, kwargs: dict[str, object]) -> dict[str, object]:
    model_fields = getattr(model_cls, "model_fields", {})
    if not model_fields:
        return {}
    return {key: value for key, value in kwargs.items() if key in model_fields}


@cache
def get_model(model_name: AllModelEnum, /) -> ModelT:
    # NOTE: models with streaming=True will send tokens as they are generated
    # if the /stream endpoint is called with stream_tokens=True (the default)
    api_model_name = _MODEL_TABLE.get(model_name)
    if not api_model_name:
        raise ValueError(f"Unsupported model: {model_name}")

    if model_name in OpenAIModelName:
        return ChatOpenAI(
            model=api_model_name,
            temperature=0.5,
            streaming=True,
            **_supported_model_kwargs(ChatOpenAI, _OPENAI_REASONING_KWARGS),
        )
    if model_name in OpenAICompatibleName:
        if not settings.COMPATIBLE_BASE_URL or not settings.COMPATIBLE_MODEL:
            raise ValueError("OpenAICompatible base url and endpoint must be configured")

        return ChatOpenAI(
            model=settings.COMPATIBLE_MODEL,
            temperature=0.5,
            streaming=True,
            openai_api_base=settings.COMPATIBLE_BASE_URL,
            openai_api_key=settings.COMPATIBLE_API_KEY,
            **_supported_model_kwargs(ChatOpenAI, _OPENAI_REASONING_KWARGS),
        )
    if model_name in AzureOpenAIModelName:
        if not settings.AZURE_OPENAI_API_KEY or not settings.AZURE_OPENAI_ENDPOINT:
            raise ValueError("Azure OpenAI API key and endpoint must be configured")

        return AzureChatOpenAI(
            azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
            deployment_name=api_model_name,
            api_version=settings.AZURE_OPENAI_API_VERSION,
            temperature=0.5,
            streaming=True,
            timeout=60,
            max_retries=3,
            **_supported_model_kwargs(AzureChatOpenAI, _OPENAI_REASONING_KWARGS),
        )
    if model_name in DeepseekModelName:
        return ChatOpenAI(
            model=api_model_name,
            temperature=0.5,
            streaming=True,
            openai_api_base="https://api.deepseek.com",
            openai_api_key=settings.DEEPSEEK_API_KEY,
            **_supported_model_kwargs(ChatOpenAI, _OPENAI_REASONING_KWARGS),
        )
    if model_name in AnthropicModelName:
        return ChatAnthropic(
            model=api_model_name,
            temperature=0.5,
            streaming=True,
            **_supported_model_kwargs(ChatAnthropic, _ANTHROPIC_THINKING_KWARGS),
        )
    if model_name in GoogleModelName:
        return ChatGoogleGenerativeAI(
            model=api_model_name,
            temperature=0.5,
            streaming=True,
            **_supported_model_kwargs(ChatGoogleGenerativeAI, _GOOGLE_THINKING_KWARGS),
        )
    if model_name in GroqModelName:
        if model_name == GroqModelName.LLAMA_GUARD_4_12B:
            return ChatGroq(model_name=api_model_name, temperature=0.0)
        return ChatGroq(model_name=api_model_name, temperature=0.5)
    if model_name in AWSModelName:
        return ChatBedrock(model_id=api_model_name, temperature=0.5)
    if model_name in OllamaModelName:
        if settings.OLLAMA_BASE_URL:
            chat_ollama = ChatOllama(
                model=settings.OLLAMA_MODEL, temperature=0.5, base_url=settings.OLLAMA_BASE_URL
            )
        else:
            chat_ollama = ChatOllama(model=settings.OLLAMA_MODEL, temperature=0.5)
        return chat_ollama
    if model_name in OpenRouterModelName:
        if api_model_name.startswith("anthropic/"):
            return ChatAnthropic(
                model=api_model_name,
                temperature=0.5,
                streaming=True,
                base_url=_openrouter_anthropic_base_url(),
                api_key=settings.OPENROUTER_API_KEY,
                thinking={"type": "enabled", "budget_tokens": 10000},
            )
        return ChatOpenRouter(
            model=api_model_name,
            temperature=0.5,
            streaming=True,
            base_url=settings.OPENROUTER_BASE_URL,
            api_key=settings.OPENROUTER_API_KEY,
        )
    if model_name in FakeModelName:
        return FakeToolModel(responses=["This is a test response from the fake model."])

    raise ValueError(f"Unsupported model: {model_name}")
