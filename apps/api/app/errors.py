from __future__ import annotations

from typing import Any


class AppError(Exception):
    """Error with a stable machine code and a Korean message that can be shown to users."""

    def __init__(self, status: int, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details

    def body(self) -> dict:
        out = {"error": {"code": self.code, "message": self.message}}
        if self.details is not None:
            out["error"]["details"] = self.details
        return out
