from streamlit_app import append_streamed_reasoning, combine_reasoning_chunks


def test_append_streamed_reasoning_preserves_explicit_space_tokens() -> None:
    text = ""
    for chunk in ["Plan", " ", "carefully"]:
        text = append_streamed_reasoning(text, chunk)
    assert text == "Plan carefully"


def test_append_streamed_reasoning_keeps_whitespace_only_chunks() -> None:
    text = ""
    for chunk in [" ", " "]:
        text = append_streamed_reasoning(text, chunk)
    assert text == " "


def test_append_streamed_reasoning_uses_raw_append_for_punctuation() -> None:
    text = ""
    for chunk in ["Plan", ":", " step"]:
        text = append_streamed_reasoning(text, chunk)
    assert text == "Plan: step"


def test_append_streamed_reasoning_replaces_cumulative_snapshots() -> None:
    text = ""
    for chunk in ["Plan", "Plan carefully", "Plan carefully then answer"]:
        text = append_streamed_reasoning(text, chunk)
    assert text == "Plan carefully then answer"


def test_append_streamed_reasoning_handles_overlapping_chunks() -> None:
    text = ""
    for chunk in ["Need a quick", "quick plan"]:
        text = append_streamed_reasoning(text, chunk)
    assert text == "Need a quick plan"


def test_append_streamed_reasoning_skips_duplicate_chunk() -> None:
    text = ""
    for chunk in ["Think first.", "Think first."]:
        text = append_streamed_reasoning(text, chunk)
    assert text == "Think first."


def test_combine_reasoning_chunks_merges_incremental_reasoning() -> None:
    chunks = ["Need", " a", " quick", " plan"]
    merged = combine_reasoning_chunks(chunks)
    assert merged == "Need a quick plan"


def test_combine_reasoning_chunks_replaces_near_identical_rewrite_snapshot() -> None:
    first = (
        "Gather requirements, inspect the repository, map related files, "
        "and then propose a precise implementation sequence with verification steps."
    )
    second = (
        "Gather requirements, inspect the repository, map related files, "
        "then propose a precise implementation sequence and explicit verification steps."
    )
    merged = combine_reasoning_chunks([first, second])
    assert merged == second
