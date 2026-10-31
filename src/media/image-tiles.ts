import sharp from 'sharp';

export const isLongImage = (width: number, height: number): boolean =>
  Math.max(width, height) / Math.max(1, Math.min(width, height)) >= 3;

/** Split in reading order; overlap preserves text crossing a tile boundary. */
export const splitImageTiles = async (buffer: Buffer): Promise<Buffer[]> => {
  const { width = 1, height = 1 } = await sharp(buffer).metadata();
  if (!isLongImage(width, height)) return [buffer];
  const vertical = height >= width;
  const length = Math.max(width, height);
  const tileLength = 1536;
  const stride = tileLength - 128;
  const count = Math.max(1, Math.ceil((length - tileLength) / stride) + 1);
  if (count > 32) throw new Error('Image is too long to read safely; send it in smaller sections.');
  const tiles: Buffer[] = [];
  for (let index = 0; index < count; index++) {
    const offset = index * stride;
    const size = Math.min(tileLength, length - offset);
    tiles.push(await sharp(buffer).extract({
      left: vertical ? 0 : offset,
      top: vertical ? offset : 0,
      width: vertical ? width : size,
      height: vertical ? size : height,
    }).png().toBuffer());
  }
  return tiles;
};
