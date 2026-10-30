"""fastembed BAAI/bge-small-en-v1.5, loaded once per process.

The ONNX model is ~130 MB in memory; it is created lazily on first use (the app
warms it up at startup) and shared by ingestion and retrieval.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Callable, Sequence
from functools import lru_cache

import numpy as np
from fastembed import TextEmbedding
from tokenizers import Tokenizer

from .config import EMBEDDING_MODEL, get_settings

# BGE v1.5 recommends this instruction on short queries for query -> passage search.
QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "
# Small batches keep peak memory low on a 512 MB instance.
BATCH_SIZE = int(os.environ.get("EMBED_BATCH_SIZE", "2"))

_lock = threading.Lock()


@lru_cache(maxsize=1)
def get_model() -> TextEmbedding:
    with _lock:
        return TextEmbedding(
            EMBEDDING_MODEL,
            cache_dir=get_settings().fastembed_cache_dir,
            threads=int(os.environ.get("EMBED_THREADS", "1")),
        )


@lru_cache(maxsize=1)
def get_tokenizer() -> Callable[[str], list[int]]:
    """The embedding model's own WordPiece tokenizer, without truncation.

    Chunk sizes are measured in the tokens the embedder actually sees, so a
    "350-token" chunk is never silently truncated at the model's 512 limit.
    """
    model = get_model()
    base = model.model.tokenizer  # tokenizers.Tokenizer configured by fastembed
    tok = Tokenizer.from_str(base.to_str())
    tok.no_truncation()
    tok.no_padding()
    return lambda text: tok.encode(text, add_special_tokens=False).ids


def embed_passages(texts: Sequence[str]) -> list[np.ndarray]:
    return [v.astype(np.float32) for v in get_model().embed(list(texts), batch_size=BATCH_SIZE)]


def embed_query(text: str) -> np.ndarray:
    return next(iter(get_model().embed([QUERY_INSTRUCTION + text]))).astype(np.float32)
