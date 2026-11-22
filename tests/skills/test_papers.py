import pytest
from fastapi.testclient import TestClient

from jobs import runner
from jobs.store import Job, MemoryJobStore
from skills.papers import mp3
from skills.papers.podcast import MAX_LINE_CHARS, _pieces
from skills.papers.sources import _entries, arxiv_id

# One MPEG-1 Layer III frame at 128 kbps / 44.1 kHz: 417 bytes, 1152 samples.
HEADER = b"\xff\xfb\x90\x00"
FRAME_LEN = 417


def frame(fill: int = 1) -> bytes:
    return HEADER + bytes([fill]) * (FRAME_LEN - 4)


def xing() -> bytes:
    body = bytearray(FRAME_LEN - 4)
    body[32:36] = b"Xing"
    return HEADER + bytes(body)


ID3 = b"ID3\x04\x00\x00\x00\x00\x00\x05" + b"12345"


@pytest.mark.parametrize(
    ("ref", "expected"),
    [
        ("1706.03762", "1706.03762"),
        ("arXiv:2401.01234v2", "2401.01234v2"),
        ("https://arxiv.org/abs/1706.03762v7", "1706.03762v7"),
        ("https://arxiv.org/pdf/2401.01234.pdf", "2401.01234"),
        ("hep-th/9901001", "hep-th/9901001"),
        ("attention is all you need", None),
        ("https://example.com/paper.pdf", None),
    ],
)
def test_arxiv_id(ref: str, expected: str | None) -> None:
    assert arxiv_id(ref) == expected


def test_join_drops_tags_and_xing_frames() -> None:
    one = ID3 + xing() + frame(1) + frame(2)
    two = ID3 + xing() + frame(3) + b"TAG" + bytes(125)
    joined = mp3.join([one, two])
    assert joined.frames == 3
    assert joined.data == frame(1) + frame(2) + frame(3)
    assert joined.sample_rate == 44100
    assert joined.seconds == pytest.approx(3 * 1152 / 44100)


def test_join_resyncs_past_junk() -> None:
    assert mp3.audio_frames(b"\x00junk" + frame() + frame()).frames == 2


def test_long_lines_split_at_sentences() -> None:
    text = "A short sentence here. " * 200
    pieces = _pieces(text)
    assert len(pieces) > 1
    assert all(len(p) <= MAX_LINE_CHARS and p.endswith(".") for p in pieces)
    assert " ".join(pieces) == " ".join(text.split())
    assert _pieces("  hi  there ") == ["hi there"]


def test_arxiv_entries() -> None:
    xml = """<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>http://arxiv.org/abs/1706.03762v7</id>
        <published>2017-06-12T17:57:34Z</published>
        <title>Attention Is All
          You Need</title>
        <summary>The dominant models...</summary>
        <author><name>Ashish Vaswani</name></author>
        <author><name>Noam Shazeer</name></author>
        <link title="pdf" href="http://arxiv.org/pdf/1706.03762v7"/>
      </entry>
      <entry><id>http://arxiv.org/api/errors#bad</id><title>Error</title></entry>
    </feed>"""
    [paper] = _entries(xml)
    assert paper.title == "Attention Is All You Need"
    assert paper.url == "https://arxiv.org/abs/1706.03762v7"
    assert paper.pdf_url == "https://arxiv.org/pdf/1706.03762v7"
    assert paper.arxiv_id == "1706.03762v7"
    assert paper.byline() == "Ashish Vaswani, Noam Shazeer · 2017-06-12"


@pytest.fixture
def client_with_file(monkeypatch: pytest.MonkeyPatch):
    from service import app

    store = MemoryJobStore()
    store.jobs["job-aaaaaaaaaaaa"] = Job(
        id="job-aaaaaaaaaaaa", user_id="u1", thread_id=None, workflow="papers.podcast", args={}
    )
    store.files[("job-aaaaaaaaaaaa", "episode.mp3")] = ("audio/mpeg", bytes(range(100)))
    monkeypatch.setattr(runner, "_store", store)
    return TestClient(app)


def test_job_file_endpoint(client_with_file: TestClient) -> None:
    url = "/jobs/job-aaaaaaaaaaaa/files/episode.mp3"
    full = client_with_file.get(url, params={"user_id": "u1"})
    assert full.status_code == 200
    assert full.headers["content-type"] == "audio/mpeg"
    assert full.content == bytes(range(100))

    part = client_with_file.get(url, params={"user_id": "u1"}, headers={"Range": "bytes=10-19"})
    assert part.status_code == 206
    assert part.headers["content-range"] == "bytes 10-19/100"
    assert part.content == bytes(range(10, 20))

    tail = client_with_file.get(url, params={"user_id": "u1"}, headers={"Range": "bytes=-5"})
    assert tail.content == bytes(range(95, 100))

    assert (
        client_with_file.get(
            url, params={"user_id": "u1"}, headers={"Range": "bytes=200-"}
        ).status_code
        == 416
    )
    assert client_with_file.get(url, params={"user_id": "someone-else"}).status_code == 404
