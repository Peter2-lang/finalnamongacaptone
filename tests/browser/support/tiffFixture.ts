import UTIF from 'utif';
export function multipageTiff(rgba: Uint8Array, width: number, height: number): ArrayBuffer {
  const frame = (offset: number) => ({ t256: [width], t257: [height], t258: [8, 8, 8, 8], t259: [1], t262: [2], t273: [offset], t277: [4], t278: [height], t279: [rgba.length], t338: [1] });
  const header = new Uint8Array(UTIF.encode([frame(1000), frame(1000 + rgba.length)]));
  if (header.length > 1000) throw new Error('Fixture header too large');
  const bytes = new Uint8Array(1000 + rgba.length * 2); bytes.set(header); bytes.set(rgba, 1000); bytes.set(rgba, 1000 + rgba.length);
  return bytes.buffer;
}
