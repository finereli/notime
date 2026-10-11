// pwa-kit: image-resize/lib/image-resize.ts v1
// Resize an image on the client before uploading it. Phones produce 12MB
// photos; nothing downstream wants them. Max dimension 1568px (Claude
// downscales to that anyway), JPEG at 0.85, stepping quality down to 0.3
// until the result is under 4MB. Seams: the three constants.
//
//   const { blob, width, height } = await resizeImage(file)

const MAX_DIMENSION = 2048
const JPEG_QUALITY = 0.85
const MAX_FILE_SIZE = 4 * 1024 * 1024

export interface ResizedImage { blob: Blob; width: number; height: number; originalSize: number }

export async function resizeImage(file: File): Promise<ResizedImage> {
  const originalSize = file.size
  const img = await loadImage(file)
  let { width, height } = img

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height)
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)

  let quality = JPEG_QUALITY
  let blob = await canvasToBlob(canvas, 'image/jpeg', quality)
  while (blob.size > MAX_FILE_SIZE && quality > 0.3) {
    quality -= 0.1
    blob = await canvasToBlob(canvas, 'image/jpeg', quality)
  }
  return { blob, width, height, originalSize }
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)
      resolve(img)
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))), type, quality)
  })
}
