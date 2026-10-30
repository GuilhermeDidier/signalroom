"""Streams answer text while removing the trailing <answerable>..</answerable> tag.

The model ends each final reply with `<answerable>yes|partial|no</answerable>`. The
tag must never reach the customer, but text arrives in arbitrary fragments, so any
`<` that could start the tag is held back until it is resolved.
"""

from __future__ import annotations

import re

_TAG_OPEN = "<answerable>"
_FULL = re.compile(r"<answerable>\s*(yes|partial|no)\s*</answerable>", re.IGNORECASE)


class AnswerableFilter:
    def __init__(self) -> None:
        self._buf = ""
        self.flag: str | None = None

    def feed(self, text: str) -> str:
        self._buf += text
        out: list[str] = []
        while self._buf:
            i = self._buf.find("<")
            if i < 0:
                out.append(self._buf)
                self._buf = ""
                break
            out.append(self._buf[:i])
            rest = self._buf[i:]
            m = _FULL.match(rest)
            if m:
                self.flag = m.group(1).lower()
                self._buf = rest[m.end() :]
                continue
            could_be_tag = _TAG_OPEN.startswith(rest[: len(_TAG_OPEN)].lower()) and len(rest) < 64
            if could_be_tag:
                self._buf = rest  # wait for more text
                break
            out.append("<")
            self._buf = rest[1:]
        return "".join(out)

    def flush(self) -> str:
        rest, self._buf = self._buf, ""
        if rest.lower().startswith("<answerable"):
            m = re.search(r"(yes|partial|no)", rest, re.IGNORECASE)
            if m:
                self.flag = m.group(1).lower()
            return ""
        return rest
