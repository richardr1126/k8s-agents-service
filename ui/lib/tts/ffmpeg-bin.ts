import fs from 'fs';
import ffmpegStatic from 'ffmpeg-static';

/**
 * The ffmpeg executable for audio conversion: FFMPEG_BIN when set, else the
 * binary bundled by ffmpeg-static (which is what runs on Vercel), else `ffmpeg`
 * on PATH.
 */
export function getFFmpegPath(): string {
  const configured = process.env.FFMPEG_BIN?.trim();
  if (configured) {
    if ((configured.includes('/') || configured.includes('\\')) && !fs.existsSync(configured)) {
      throw new Error(`FFMPEG_BIN points to a missing binary: ${configured}`);
    }
    return configured;
  }
  return ffmpegStatic && fs.existsSync(ffmpegStatic) ? ffmpegStatic : 'ffmpeg';
}
