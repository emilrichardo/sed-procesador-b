# PDF Processor API

API REST especializada en procesamiento de PDFs usando Node.js, Sharp y Gemini 2.0 Flash.

## Requisitos Previos

- Node.js (v18+)
- GraphicsMagick y Ghostscript (necesarios para `pdf2pic`)
  - Mac: `brew install graphicsmagick ghostscript`
  - Linux: `sudo apt-get install graphicsmagick ghostscript`

## Configuración

1. Crear archivo `.env` en la raíz:

```env
PORT=3210
GEMINI_API_KEY=tu_clave_api_aqui
```

2. Instalar dependencias:

```bash
npm install
```

## Ejecución

```bash
npm start
```

El servidor correrá en `http://localhost:3210`.

## API Endpoints

### POST `/api/process-pdf`

Sube un archivo PDF para procesamiento.

**Body:** `multipart/form-data`

- `pdf`: Archivo PDF (Required)

**Proceso:**

1. Recibe el PDF.
2. Convierte páginas a imágenes JPG de alta calidad.
3. Aplica recorte dinámico (Top 6%, Bottom 7.5%) usando Sharp.
4. Envía cada imagen a Gemini 2.0 Flash para extracción de datos estructurados.
5. Consolida los resultados en un único array JSON.

**Respuesta:**

```json
{
  "success": true,
  "data": [
    { ...datos_pagina_1 },
    { ...datos_pagina_2 }
  ]
}
```

## Estructura del Proyecto

- `src/server.js`: Punto de entrada.
- `src/controllers/pdfController.js`: Lógica de orquestación.
- `src/services/imageService.js`: Manejo de imágenes (Conversión/Recorte).
- `src/services/geminiService.js`: Integración con Google Gemini.
