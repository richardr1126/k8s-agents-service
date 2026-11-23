"""Joining MP3 segments into one file without re-encoding.

Each segment from a TTS provider is a complete MP3: maybe an ID3 tag, then a
Xing/Info frame describing that segment alone, then audio frames. Joined as
is, players read the first Xing frame and show the first segment's length,
so the tags and Xing frames are dropped and only audio frames are kept.
"""

from __future__ import annotations

from dataclasses import dataclass

# Bitrates (kbps) by [version is MPEG-1][layer III index], sample rates by version.
_BITRATES = {
    True: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
    False: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
}
_RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


@dataclass
class Frames:
    data: bytes
    frames: int
    seconds: float
    sample_rate: int


def _skip_id3(data: bytes) -> int:
    if data[:3] == b"ID3" and len(data) >= 10:
        size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
        return 10 + size + (10 if data[5] & 0x10 else 0)
    return 0


def _header(data: bytes, i: int) -> tuple[int, int, int] | None:
    """(frame length, samples per frame, sample rate) of a Layer III frame at i, else None."""
    if i + 4 > len(data) or data[i] != 0xFF or (data[i + 1] & 0xE0) != 0xE0:
        return None
    version = (data[i + 1] >> 3) & 0x3  # 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
    layer = (data[i + 1] >> 1) & 0x3  # 1 = Layer III
    bitrate_idx, rate_idx = data[i + 2] >> 4, (data[i + 2] >> 2) & 0x3
    if version == 1 or layer != 1 or rate_idx == 3 or bitrate_idx in (0, 15):
        return None
    mpeg1 = version == 3
    bitrate = _BITRATES[mpeg1][bitrate_idx] * 1000
    rate = _RATES[version][rate_idx]
    padding = (data[i + 2] >> 1) & 0x1
    samples = 1152 if mpeg1 else 576
    return (samples // 8 * bitrate // rate + padding, samples, rate)


def audio_frames(segment: bytes) -> Frames:
    """The audio frames of one MP3, without tags or a Xing/Info frame."""
    i = _skip_id3(segment)
    end = len(segment) - (128 if segment[-128:-125] == b"TAG" else 0)
    out = bytearray()
    frames = 0
    seconds = 0.0
    rate = 0
    first = True
    while i < end:
        head = _header(segment, i)
        if head is None:  # resync on junk
            i += 1
            continue
        length, samples, rate = head
        frame = segment[i : i + length]
        if len(frame) < length:
            break
        if not (first and (b"Xing" in frame[:64] or b"Info" in frame[:64])):
            out += frame
            frames += 1
            seconds += samples / rate
        first = False
        i += length
    return Frames(bytes(out), frames, seconds, rate)


def join(segments: list[bytes]) -> Frames:
    parts = [audio_frames(s) for s in segments]
    return Frames(
        b"".join(p.data for p in parts),
        sum(p.frames for p in parts),
        sum(p.seconds for p in parts),
        next((p.sample_rate for p in parts if p.sample_rate), 0),
    )
