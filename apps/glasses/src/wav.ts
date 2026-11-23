/** Wrap PCM s16le mono chunks in a 44-byte-header WAV. */
export function encodeWav(chunks: Uint8Array[], sampleRate = 16000): Uint8Array {
  const dataLen = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(44 + dataLen)
  const v = new DataView(out.buffer)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i) }
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, dataLen, true)
  let o = 44
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}
