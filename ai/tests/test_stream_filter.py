from signalroom_ai.agent.stream_filter import AnswerableFilter


def run(chunks):
    f = AnswerableFilter()
    out = "".join(f.feed(c) for c in chunks) + f.flush()
    return out, f.flag


def test_tag_is_removed_across_fragments():
    out, flag = run(["Frames are covered [1].\n<ans", "werable>ye", "s</answerable>"])
    assert out == "Frames are covered [1].\n" and flag == "yes"


def test_other_angle_brackets_pass_through():
    out, flag = run(["Use a <b>bold</b> a < b comparison"])
    assert out == "Use a <b>bold</b> a < b comparison" and flag is None


def test_truncated_tag_is_dropped_on_flush():
    out, flag = run(["Answer.\n<answerable>partial"])
    assert out == "Answer.\n" and flag == "partial"
