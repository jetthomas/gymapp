// Profile picture limits. The API caps the stored picture again (MAX_AVATAR_CHARS in gym-api/src/auth.rs);
// this one only stops a member waiting on a file that will never fit
const MAX_PHOTO_MB = 20; // the photo picked
const QUALITY = 0.85; // JPEG quality, 0 to 1
const SIZE_PX = 256; // the stored picture is SIZE_PX x SIZE_PX

// Any photo -> a square JPEG, centre-cropped, as base64 without the "data:" prefix.
// Drawing it on a canvas also drops the EXIF data (camera, date, GPS location)
export async function toAvatar(file) {
  if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
    throw new Error(`Pick a photo under ${MAX_PHOTO_MB} MB.`);
  }
  const img = await createImageBitmap(file).catch(() => {
    throw new Error("That file isn't a photo we can read. Try another one.");
  });
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE_PX;
  canvas
    .getContext('2d')
    .drawImage(
      img,
      (img.width - side) / 2,
      (img.height - side) / 2,
      side,
      side,
      0,
      0,
      SIZE_PX,
      SIZE_PX,
    );
  return canvas.toDataURL('image/jpeg', QUALITY).split(',')[1];
}
