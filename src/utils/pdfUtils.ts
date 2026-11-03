import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

interface PdfExportOptions {
  format?: 'a4' | 'letter' | 'legal';
  orientation?: 'portrait' | 'landscape';
  marginMm?: number;
  scale?: number;
}

function sanitizeOklchColors(cssText: string, context: CanvasRenderingContext2D | null): string {
  return cssText.replace(/oklch\([^)]+\)/gi, value => {
    if (!context) return '#1e293b';
    context.fillStyle = '#1e293b';
    context.fillStyle = value;
    return context.fillStyle;
  });
}

export async function downloadElementAsPdf(
  element: HTMLElement,
  filename: string,
  options: PdfExportOptions = {}
): Promise<void> {
  const {
    format = 'letter',
    orientation = 'portrait',
    marginMm = 10,
    scale = 2,
  } = options;
  const images = Array.from(element.querySelectorAll('img'));
  await Promise.all(images.map(async image => {
    if (!image.complete) {
      await new Promise<void>((resolve, reject) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => reject(new Error(`Unable to load certificate image "${image.alt || image.src}".`)), { once: true });
      });
    }
    if (image.naturalWidth === 0) {
      throw new Error(`Unable to load certificate image "${image.alt || image.src}".`);
    }
    await image.decode();
  }));
  const canvas = await html2canvas(element, {
    scale,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    onclone: clonedDocument => {
      const context = clonedDocument.createElement('canvas').getContext('2d');
      clonedDocument.querySelectorAll('style').forEach(style => {
        style.textContent = sanitizeOklchColors(style.textContent || '', context);
      });
      clonedDocument.querySelectorAll<HTMLElement>('[style]').forEach(node => {
        node.style.cssText = sanitizeOklchColors(node.style.cssText, context);
      });
    },
  });

  if (canvas.width === 0 || canvas.height === 0) {
    throw new Error('The document preview is empty and cannot be exported.');
  }

  const pdf = new jsPDF({ orientation, unit: 'mm', format });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - marginMm * 2;
  const contentHeight = pageHeight - marginMm * 2;
  const mmPerPixel = contentWidth / canvas.width;
  const sliceHeight = Math.max(1, Math.floor(contentHeight / mmPerPixel));

  for (let sourceY = 0; sourceY < canvas.height; sourceY += sliceHeight) {
    if (sourceY > 0) pdf.addPage(format, orientation);

    const currentSliceHeight = Math.min(sliceHeight, canvas.height - sourceY);
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = currentSliceHeight;
    const context = pageCanvas.getContext('2d');
    if (!context) throw new Error('Unable to prepare a PDF page from the document preview.');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(
      canvas,
      0,
      sourceY,
      canvas.width,
      currentSliceHeight,
      0,
      0,
      pageCanvas.width,
      pageCanvas.height
    );

    const pageImage = pageCanvas.toDataURL('image/jpeg', 0.95);
    pdf.addImage(
      pageImage,
      'JPEG',
      marginMm,
      marginMm,
      contentWidth,
      currentSliceHeight * mmPerPixel
    );
  }

  pdf.save(filename);
}
