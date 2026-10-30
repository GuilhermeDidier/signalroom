import pytest

from signalroom_ai.retrieval import RRF_K, rrf_fuse


def test_rrf_scores_and_order():
    fused = dict(rrf_fuse([[1, 2, 3], [3, 4]]))
    assert fused[3] == pytest.approx(1 / (RRF_K + 3) + 1 / (RRF_K + 1))
    assert fused[1] == pytest.approx(1 / (RRF_K + 1))
    order = [i for i, _ in rrf_fuse([[1, 2, 3], [3, 4]])]
    assert order[0] == 3  # in both lists beats rank-1 in one list
    assert set(order) == {1, 2, 3, 4}


def test_rrf_single_list_keeps_order():
    assert [i for i, _ in rrf_fuse([[7, 5, 9]])] == [7, 5, 9]


def test_rrf_empty():
    assert rrf_fuse([[], []]) == []
