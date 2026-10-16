export const MAX_EVIDENCE_FILES = 8;
export const PHOTO_LIMIT = 10 * 1024 * 1024;
export const VIDEO_LIMIT = 50 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
export const MEDIA_ACCEPT = [...PHOTO_TYPES, ...VIDEO_TYPES].join(',');
export const isVideo = (type?: string) => Boolean(type?.startsWith('video/'));
export function mediaError(file: { type: string; size: number }) {
  if (![...PHOTO_TYPES, ...VIDEO_TYPES].includes(file.type))
    return 'Use fotos JPG, PNG ou WebP, ou vídeos MP4, MOV ou WebM.';
  if (
    file.size === 0 ||
    file.size > (isVideo(file.type) ? VIDEO_LIMIT : PHOTO_LIMIT)
  )
    return isVideo(file.type)
      ? 'O vídeo deve ter até 50 MB. Grave um vídeo mais curto e tente novamente.'
      : 'Cada foto deve ter até 10 MB.';
  return null;
}
// O servidor confere a assinatura do contêiner; extensão e MIME do cliente não bastam.
export function detectMedia(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length < 12) return null;
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if (
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    )
  )
    return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp') {
    const size = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(0);
    if (size < 16 || size > bytes.length || size > 4096) return null;
    const brands = ascii(8, size);
    if (brands.startsWith('qt  ')) return 'video/quicktime';
    if (/^(isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)/.test(brands))
      return 'video/mp4';
  }
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3 &&
    ascii(4, Math.min(bytes.length, 4096)).includes('webm')
  )
    return 'video/webm';
  return null;
}
