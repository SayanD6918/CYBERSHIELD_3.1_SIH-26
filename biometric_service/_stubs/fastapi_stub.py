"""Minimal stand-ins for FastAPI and Pydantic.

The service pins fastapi/uvicorn in requirements.txt, but the endpoint
handlers in main.py are plain functions - the framework only routes to them.
Registering these stubs lets the contract tests exercise the handlers on a
bare Python install, which is also how CI stays fast.
"""

from __future__ import annotations

import sys
import types
from typing import Any, get_type_hints


class _App:
    def __init__(self, **_: Any) -> None:
        self.routes: dict[str, Any] = {}

    def add_middleware(self, *_: Any, **__: Any) -> None:
        return None

    def _register(self, path: str):
        def decorator(func):
            self.routes[path] = func
            return func

        return decorator

    def get(self, path: str, **_: Any):
        return self._register(path)

    def post(self, path: str, **_: Any):
        return self._register(path)


class _BaseModel:
    def __init__(self, **values: Any) -> None:
        annotations: dict[str, Any] = {}
        for klass in reversed(type(self).__mro__):
            annotations.update(getattr(klass, "__annotations__", {}))
        for name in annotations:
            setattr(self, name, values.get(name, getattr(type(self), name, None)))


def install() -> None:
    if "fastapi" in sys.modules:
        return

    fastapi = types.ModuleType("fastapi")
    fastapi.FastAPI = _App

    middleware = types.ModuleType("fastapi.middleware")
    cors = types.ModuleType("fastapi.middleware.cors")
    cors.CORSMiddleware = object
    middleware.cors = cors

    pydantic = types.ModuleType("pydantic")
    pydantic.BaseModel = _BaseModel

    sys.modules["fastapi"] = fastapi
    sys.modules["fastapi.middleware"] = middleware
    sys.modules["fastapi.middleware.cors"] = cors
    sys.modules["pydantic"] = pydantic
