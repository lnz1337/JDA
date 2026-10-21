/**
 * Duração de um MP3 sem dependência externa.
 *
 * Lê o cabeçalho do primeiro frame; se houver tag VBR (Xing/Info ou VBRI) usa a
 * contagem de frames, que é exata. Sem tag, assume CBR e divide o tamanho pelo
 * bitrate. Devolve segundos arredondados, ou null se não parecer um MP3.
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs';

/** kbps por índice, Layer III. */
const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

const SAMPLE_RATES: Record<string, readonly number[]> = {
  '1': [44100, 48000, 32000],
  '2': [22050, 24000, 16000],
  '2.5': [11025, 12000, 8000],
};

interface FrameHeader {
  mpeg: '1' | '2' | '2.5';
  sampleRate: number;
  bitrateKbps: number;
  samplesPerFrame: number;
  mono: boolean;
}

function parseFrameHeader(buf: Buffer, at: number): FrameHeader | null {
  if (buf[at] !== 0xff || ((buf[at + 1] ?? 0) & 0xe0) !== 0xe0) return null;

  const b1 = buf[at + 1] ?? 0;
  const b2 = buf[at + 2] ?? 0;
  const b3 = buf[at + 3] ?? 0;

  const versionBits = (b1 >> 3) & 0b11;
  const layerBits = (b1 >> 1) & 0b11;
  if (versionBits === 0b01 || layerBits !== 0b01) return null; // só Layer III

  const mpeg = versionBits === 0b11 ? '1' : versionBits === 0b10 ? '2' : '2.5';
  const sampleRateIndex = (b2 >> 2) & 0b11;
  const bitrateIndex = (b2 >> 4) & 0b1111;
  if (sampleRateIndex === 0b11 || bitrateIndex === 0 || bitrateIndex === 0b1111) return null;

  const sampleRate = SAMPLE_RATES[mpeg]?.[sampleRateIndex];
  const bitrateKbps = (mpeg === '1' ? BITRATES_V1 : BITRATES_V2)[bitrateIndex];
  if (!sampleRate || !bitrateKbps) return null;

  return {
    mpeg,
    sampleRate,
    bitrateKbps,
    samplesPerFrame: mpeg === '1' ? 1152 : 576,
    mono: ((b3 >> 6) & 0b11) === 0b11,
  };
}

/** Offset do áudio: pula a tag ID3v2, se houver. */
function audioStart(buf: Buffer): number {
  if (buf.subarray(0, 3).toString('latin1') !== 'ID3') return 0;
  const flags = buf[5] ?? 0;
  const size =
    ((buf[6] ?? 0) << 21) | ((buf[7] ?? 0) << 14) | ((buf[8] ?? 0) << 7) | (buf[9] ?? 0);
  return 10 + size + ((flags & 0x10) !== 0 ? 10 : 0); // + footer
}

/** Frames declarados por Xing/Info ou VBRI, quando existirem. */
function vbrFrameCount(buf: Buffer, frameAt: number, header: FrameHeader): number | null {
  const xingAt =
    frameAt + 4 + (header.mpeg === '1' ? (header.mono ? 17 : 32) : header.mono ? 9 : 17);
  const tag = buf.subarray(xingAt, xingAt + 4).toString('latin1');
  if (tag === 'Xing' || tag === 'Info') {
    const flags = buf.readUInt32BE(xingAt + 4);
    if ((flags & 0x1) !== 0) return buf.readUInt32BE(xingAt + 8);
    return null;
  }

  const vbriAt = frameAt + 36;
  if (buf.subarray(vbriAt, vbriAt + 4).toString('latin1') === 'VBRI') {
    return buf.readUInt32BE(vbriAt + 14);
  }
  return null;
}

export function mp3DurationSeconds(path: string): number | null {
  const fileSize = statSync(path).size;
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(Math.min(fileSize, 64 * 1024));
  try {
    readSync(fd, buf, 0, buf.length, 0);
  } finally {
    closeSync(fd);
  }

  const start = audioStart(buf);

  // O primeiro sync pode estar alguns bytes à frente (lixo entre a tag e o áudio).
  for (let at = start; at < Math.min(buf.length - 4, start + 8192); at += 1) {
    const header = parseFrameHeader(buf, at);
    if (!header) continue;

    const frames = vbrFrameCount(buf, at, header);
    const seconds =
      frames !== null
        ? (frames * header.samplesPerFrame) / header.sampleRate
        : ((fileSize - at) * 8) / (header.bitrateKbps * 1000);

    return Math.round(seconds);
  }

  return null;
}
