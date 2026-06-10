const { createCanvas } = require('canvas')
const fs = require('fs')
const path = require('path')

const SIZE = 1024
const canvas = createCanvas(SIZE, SIZE)
const ctx = canvas.getContext('2d')

// --- Fondo redondeado ---
const r = 220
ctx.beginPath()
ctx.moveTo(r, 0)
ctx.lineTo(SIZE - r, 0)
ctx.quadraticCurveTo(SIZE, 0, SIZE, r)
ctx.lineTo(SIZE, SIZE - r)
ctx.quadraticCurveTo(SIZE, SIZE, SIZE - r, SIZE)
ctx.lineTo(r, SIZE)
ctx.quadraticCurveTo(0, SIZE, 0, SIZE - r)
ctx.lineTo(0, r)
ctx.quadraticCurveTo(0, 0, r, 0)
ctx.closePath()

// Gradiente azul oscuro (paleta del app)
const bg = ctx.createLinearGradient(0, 0, SIZE, SIZE)
bg.addColorStop(0, '#1a1a2e')
bg.addColorStop(1, '#16213e')
ctx.fillStyle = bg
ctx.fill()

// --- Documento (hoja) ---
const docX = 260, docY = 180, docW = 400, docH = 520, docR = 28
const foldSize = 90

// Sombra del documento
ctx.shadowColor = 'rgba(0,0,0,0.5)'
ctx.shadowBlur = 40
ctx.shadowOffsetY = 12

ctx.beginPath()
ctx.moveTo(docX + docR, docY)
ctx.lineTo(docX + docW - foldSize, docY)          // top edge hasta el fold
ctx.lineTo(docX + docW, docY + foldSize)          // diagonal del fold
ctx.lineTo(docX + docW, docY + docH - docR)       // right edge
ctx.quadraticCurveTo(docX + docW, docY + docH, docX + docW - docR, docY + docH)
ctx.lineTo(docX + docR, docY + docH)
ctx.quadraticCurveTo(docX, docY + docH, docX, docY + docH - docR)
ctx.lineTo(docX, docY + docR)
ctx.quadraticCurveTo(docX, docY, docX + docR, docY)
ctx.closePath()
ctx.fillStyle = '#e2e8f0'
ctx.fill()
ctx.shadowColor = 'transparent'

// Fold triangle (esquina doblada)
ctx.beginPath()
ctx.moveTo(docX + docW - foldSize, docY)
ctx.lineTo(docX + docW - foldSize, docY + foldSize)
ctx.lineTo(docX + docW, docY + foldSize)
ctx.closePath()
ctx.fillStyle = '#94a3b8'
ctx.fill()

// --- Líneas de texto en el documento ---
const lineColor = '#94a3b8'
const lineX = docX + 52
const lineW = docW - 104
const lineH = 18
const lineGap = 36
const lineStart = docY + 140

for (let i = 0; i < 5; i++) {
  const w = i === 2 ? lineW * 0.6 : lineW
  ctx.fillStyle = lineColor
  ctx.beginPath()
  ctx.roundRect(lineX, lineStart + i * lineGap, w, lineH, 6)
  ctx.fill()
}

// --- Flecha de rename (→) sobre el documento ---
ctx.shadowColor = 'rgba(233,69,96,0.5)'
ctx.shadowBlur = 30
ctx.shadowOffsetY = 0

const arrCx = 680, arrCy = 560
const arrColor = '#e94560'

// Cuerpo de la flecha
ctx.beginPath()
ctx.moveTo(arrCx - 120, arrCy - 22)
ctx.lineTo(arrCx + 20,  arrCy - 22)
ctx.lineTo(arrCx + 20,  arrCy - 60)
ctx.lineTo(arrCx + 140, arrCy)
ctx.lineTo(arrCx + 20,  arrCy + 60)
ctx.lineTo(arrCx + 20,  arrCy + 22)
ctx.lineTo(arrCx - 120, arrCy + 22)
ctx.closePath()
ctx.fillStyle = arrColor
ctx.fill()
ctx.shadowColor = 'transparent'

// --- Texto "RJF" pequeño en la esquina inferior ---
ctx.font = 'bold 72px sans-serif'
ctx.fillStyle = 'rgba(233,69,96,0.7)'
ctx.textAlign = 'right'
ctx.textBaseline = 'bottom'
ctx.fillText('RJF', SIZE - 60, SIZE - 55)

// Guardar PNG 1024x1024
const outPath = path.join(__dirname, 'icon.png')
fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
console.log('icon.png generado en:', outPath)
