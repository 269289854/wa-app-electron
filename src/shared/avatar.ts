export function readFileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

export function cropAvatarDataUrl(sourceDataUrl: string, scale: number) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('无法创建图片画布'));
        return;
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, size, size);
      const sourceSize = Math.min(image.naturalWidth, image.naturalHeight) / Math.max(1, scale);
      const sx = Math.max(0, (image.naturalWidth - sourceSize) / 2);
      const sy = Math.max(0, (image.naturalHeight - sourceSize) / 2);
      context.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    image.onerror = () => reject(new Error('头像图片读取失败'));
    image.src = sourceDataUrl;
  });
}

export function initials(label: string) {
  const text = label.trim();
  if (!text) return 'WA';
  return [...text].slice(0, 2).join('').toUpperCase();
}
