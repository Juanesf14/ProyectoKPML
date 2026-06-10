const { pathToFileURL } = require('url')

// Both canvas and tesseract.js are optional native dependencies that can fail
// to build on some platforms (e.g. Windows ARM, older Node versions).
// Lazy-load them so a missing native module doesn't crash the entire backend —
// ocrExtract simply returns '' when either is unavailable.
let _createCanvas = null
let _createWorker = null

function getCreateCanvas() {
  if (_createCanvas === null) {
    try {
      _createCanvas = require('canvas').createCanvas
    } catch (e) {
      console.warn('[ocr] canvas not available:', e.message)
      _createCanvas = false
    }
  }
  return _createCanvas || null
}

function getCreateWorker() {
  if (_createWorker === null) {
    try {
      _createWorker = require('tesseract.js').createWorker
    } catch (e) {
      console.warn('[ocr] tesseract.js not available:', e.message)
      _createWorker = false
    }
  }
  return _createWorker || null
}

/**
 * Renders the first page of a PDF to a PNG buffer for Tesseract.
 * Scale 2.0 gives 144 DPI which is sufficient for Tesseract accuracy
 * without excessive memory use.
 *
 * pdfjs-dist v5 is ESM-only, so it must be loaded with dynamic import().
 */
const pdfToImageBuffer = async (filePath) => {
  const createCanvas = getCreateCanvas()
  if (!createCanvas) throw new Error('canvas not available')

  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const fileUrl = pathToFileURL(filePath).href
  const loadingTask = pdfjsLib.getDocument({ url: fileUrl, verbosity: 0 })
  const pdf  = await loadingTask.promise
  const page = await pdf.getPage(1)

  const scale    = 2.0
  const viewport = page.getViewport({ scale })
  const canvas   = createCanvas(viewport.width, viewport.height)
  const ctx      = canvas.getContext('2d')

  await page.render({
    canvasContext: ctx,
    viewport,
    canvasFactory: {
      create:  (w, h) => { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') } },
      reset:   (data, w, h) => { data.canvas.width = w; data.canvas.height = h },
      destroy: () => {},
    },
  }).promise

  return canvas.toBuffer('image/png')
}

/**
 * Extracts text from a scanned PDF via Tesseract OCR.
 * Returns an empty string (rather than throwing) so the caller can decide
 * whether to surface an error or silently skip the document.
 */
const ocrExtract = async (filePath) => {
  const createWorker = getCreateWorker()
  if (!createWorker) return ''

  try {
    const imageBuffer = await pdfToImageBuffer(filePath)

    const worker = await createWorker('eng', 1, {
      logger:       () => {},
      errorHandler: () => {},
    })

    const { data: { text } } = await worker.recognize(imageBuffer)
    await worker.terminate()

    return text || ''
  } catch (err) {
    console.warn('[ocr] extraction failed:', err.message)
    return ''
  }
}

/**
 * Extracts text from a JPG, PNG, or other image file via Tesseract OCR.
 * Skips the PDF→image render step since the file is already an image.
 * Returns an empty string on failure so the caller degrades gracefully.
 */
const ocrExtractImage = async (filePath) => {
  const createWorker = getCreateWorker()
  if (!createWorker) return ''

  try {
    const fs = require('fs')
    const imageBuffer = fs.readFileSync(filePath)

    const worker = await createWorker('eng', 1, {
      logger:       () => {},
      errorHandler: () => {},
    })

    const { data: { text } } = await worker.recognize(imageBuffer)
    await worker.terminate()

    return text || ''
  } catch (err) {
    console.warn('[ocr] image extraction failed:', err.message)
    return ''
  }
}

/**
 * Extracts text from multiple pages of a scanned PDF via Tesseract OCR.
 * Creates a single worker and reuses it across pages for efficiency.
 * Used by the billing parser which may need more than page 1.
 */
const ocrExtractMultiPages = async (filePath, maxPages = 10) => {
  const createCanvas = getCreateCanvas()
  const createWorker = getCreateWorker()
  if (!createCanvas || !createWorker) return ''

  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const fileUrl = pathToFileURL(filePath).href
    const loadingTask = pdfjsLib.getDocument({ url: fileUrl, verbosity: 0 })
    const pdf = await loadingTask.promise

    const numPages = Math.min(pdf.numPages, maxPages)
    const canvasFactory = {
      create:  (w, h) => { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') } },
      reset:   (data, w, h) => { data.canvas.width = w; data.canvas.height = h },
      destroy: () => {},
    }
    const worker = await createWorker('eng', 1, {
      logger:       () => {},
      errorHandler: () => {},
    })

    const texts = []
    for (let i = 1; i <= numPages; i++) {
      const page     = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 2.0 })
      const canvas   = createCanvas(viewport.width, viewport.height)
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        canvasFactory,
      }).promise
      const { data: { text } } = await worker.recognize(canvas.toBuffer('image/png'))
      texts.push(text || '')
    }

    await worker.terminate()
    return texts.join('\n\n')
  } catch (err) {
    console.warn('[ocr] multi-page extraction failed:', err.message)
    return ''
  }
}

module.exports = { ocrExtract, ocrExtractImage, ocrExtractMultiPages }
