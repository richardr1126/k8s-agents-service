__all__ = ["app"]


def __getattr__(name: str):
    """Lazy-export `app` to avoid import side effects during package initialization."""
    if name == "app":
        from service.service import app

        return app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
