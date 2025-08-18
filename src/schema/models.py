from enum import StrEnum, auto
from typing import TypeAlias


class Provider(StrEnum):
    OPENAI = auto()
    OPENAI_COMPATIBLE = auto()
    AZURE_OPENAI = auto()
    DEEPSEEK = auto()
    ANTHROPIC = auto()
    GOOGLE = auto()
    VERTEXAI = auto()
    GROQ = auto()
    AWS = auto()
    OLLAMA = auto()
    OPENROUTER = auto()
    FAKE = auto()


class OpenAIModelName(StrEnum):
    """https://platform.openai.com/docs/models/gpt-4o"""

    GPT_4O = "openai-gpt-4o"
    GPT_4O_MINI = "openai-gpt-4o-mini"


class AzureOpenAIModelName(StrEnum):
    """Azure OpenAI model names"""

    AZURE_GPT_4O = "gpt-4o"
    AZURE_GPT_41 = "gpt-4.1"
    AZURE_GPT_5_CHAT = "gpt-5-chat"


class DeepseekModelName(StrEnum):
    """https://api-docs.deepseek.com/quick_start/pricing"""

    DEEPSEEK_CHAT = "deepseek-chat"


class AnthropicModelName(StrEnum):
    """https://docs.anthropic.com/en/docs/about-claude/models#model-names"""

    HAIKU_3 = "claude-3-haiku"
    HAIKU_35 = "claude-3.5-haiku"
    SONNET_35 = "claude-3.5-sonnet"


class GoogleModelName(StrEnum):
    """https://ai.google.dev/gemini-api/docs/models/gemini"""

    GEMINI_15_PRO = "gemini-1.5-pro"
    GEMINI_20_FLASH = "gemini-2.0-flash"
    GEMINI_20_FLASH_LITE = "gemini-2.0-flash-lite"
    GEMINI_25_FLASH = "gemini-2.5-flash"
    GEMINI_25_PRO = "gemini-2.5-pro"


class VertexAIModelName(StrEnum):
    """https://cloud.google.com/vertex-ai/generative-ai/docs/models"""

    GEMINI_15_PRO = "gemini-1.5-pro"
    GEMINI_20_FLASH = "gemini-2.0-flash"
    GEMINI_20_FLASH_LITE = "models/gemini-2.0-flash-lite"
    GEMINI_25_FLASH = "models/gemini-2.5-flash"
    GEMINI_25_PRO = "gemini-2.5-pro"


class GroqModelName(StrEnum):
    """https://console.groq.com/docs/models"""

    LLAMA_31_8B = "llama-3.1-8b"
    LLAMA_33_70B = "llama-3.3-70b"

    LLAMA_GUARD_4_12B = "meta-llama/llama-guard-4-12b"


class AWSModelName(StrEnum):
    """https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html"""

    BEDROCK_HAIKU = "bedrock-3.5-haiku"
    BEDROCK_SONNET = "bedrock-3.5-sonnet"


class OllamaModelName(StrEnum):
    """https://ollama.com/search"""

    OLLAMA_GENERIC = "ollama"


class OpenRouterModelName(StrEnum):
    """https://openrouter.ai/models"""

    GEMINI_25_FLASH = "google/gemini-2.5-flash"
    QWEN_3_CODER = "qwen/qwen3-coder"
    KIMI_K2 = "moonshotai/kimi-k2"
    CLAUDE_SONNET_4 = "anthropic/claude-sonnet-4"
    GPT_OSS = "openai/gpt-oss-120b"
    GPT_OSS_20B = "openai/gpt-oss-20b"
    GLM_4_5 = "z-ai/glm-4.5"

class OpenAICompatibleName(StrEnum):
    """https://platform.openai.com/docs/guides/text-generation"""

    OPENAI_COMPATIBLE = "openai-compatible"


class FakeModelName(StrEnum):
    """Fake model for testing."""

    FAKE = "fake"


AllModelEnum: TypeAlias = (
    OpenAIModelName
    | OpenAICompatibleName
    | AzureOpenAIModelName
    | DeepseekModelName
    | AnthropicModelName
    | GoogleModelName
    | VertexAIModelName
    | GroqModelName
    | AWSModelName
    | OllamaModelName
    | OpenRouterModelName
    | FakeModelName
)
