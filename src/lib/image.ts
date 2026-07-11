import sharp from "sharp";

/**
 * Soft downscale applied right before classification, purely to cut image-token cost on oversized
 * uploads (phone photos routinely come in at 3000-4000px). 1568px is Claude's own documented
 * target for the long edge of a vision input - resizing to it ourselves doesn't throw away any
 * detail the model would actually use, it just avoids uploading/tokenizing a much larger original
 * for no benefit. Anything already at or under that size is returned completely untouched: no
 * re-encoding, no quality loss, not even a decode.
 */
const MAX_DIMENSION = 1568;
const JPEG_QUALITY = 90;

/**
 * Re-encoding preserves format by content type instead of flattening everything to JPEG. JPEG
 * inputs - which in practice are almost always real photos - are re-encoded at high quality.
 * Everything else (PNG/GIF/WebP - almost always drawings, screenshots, or line art) is re-encoded
 * losslessly as PNG instead, since JPEG's block-based compression tends to blur the sharp edges
 * and flat colors that kind of image depends on for the model to tell it apart from a photo at all.
 */
export async function downscaleForClassification(
  data: Buffer,
  mediaType: string
): Promise<{ data: Buffer; mediaType: string }> {
  try {
    const metadata = await sharp(data).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
      return { data, mediaType };
    }

    const resized = sharp(data).resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });

    if (mediaType === "image/jpeg") {
      const jpeg = await resized.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
      return { data: jpeg, mediaType: "image/jpeg" };
    }

    const png = await resized.png({ compressionLevel: 9 }).toBuffer();
    return { data: png, mediaType: "image/png" };
  } catch (err) {
    console.error("Downscaling failed, classifying the original image instead:", err);
    return { data, mediaType };
  }
}
