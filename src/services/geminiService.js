const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs-extra");
const path = require("path");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const METADATA_PROMPT = `
Extrae EXCLUSIVAMENTE los siguientes metadatos de la cabecera del boletín oficial.
Formato JSON esperado:
{
  "numero_boletin": "...", (Ej: "23.012")
  "fecha_publicacion": "...", (Ej: "Lunes 19 de Enero de 2026")
}
Ignora el resto del contenido.
NO incluyas markdown.
`;

const ENTRIES_PROMPT = `
Tu misión es una extracción quirúrgica del layout. El documento tiene una barrera horizontal INSALTABLE: el título 'SECCIÓN AVISOS VARIOS'.

INSTRUCCIONES DE FLUJO ESTRICTO:
1. BLOQUE SUPERIOR: Procesa las 3 columnas de arriba de izquierda a derecha COMPLETAMENTE. No pases al bloque inferior hasta terminar las firmas de los ministros de la franja de arriba.
2. DIVISOR: Identifica 'T I T U L O  D E  S E C C I O N' como el único 'sectiontitle'.
3. BLOQUE INFERIOR: Solo después del divisor, procesa las columnas de abajo.

REGLAS DE CLASIFICACIÓN:
- 'sectiontitle': Solo títulos que cruzan las 3 columnas con interletrado ancho.  Texto en MAYÚSCULAS con mucho espacio entre cada letra (interletrado) y un espacio en blanco significativo arriba y abajo (ej: NOTIFICACIONES CATASTRALES , AVISOS VARIOS, SECCIÓN JUDICIAL, SECCIÓN AVISOS DE HOY)
- 'entrietitle': Encabezados de decretos o nombres de entidades, Títulos en MAYÚSCULAS y siempre en Negrita que inician un nuevo bloque de información y tienen un espacio en blanco superior que los separa del texto anterior y nunca esl la continuación de un parrafo, (no son válidos: EL SEÑOR GOBERNADOR DE LA PROVINCIA, ORDEN DEL DIA SANTIAGO DEL ESTERO, PLAZOS DE EJECUCION, GOBIERNO PROVINCIAL, EL SEÑOR GOBERNADOR DE LA PROVINCIA, EL SEÑOR GOBERNADOR DE LA\nPROVINCIA)) no colocar como titulo EL SEÑOR GOBERNADOR DE.
- 'entrietext': Todo el cuerpo legal, incluyendo las firmas finales (nombres de ministros).

Formato: [ { "type": "...", "content": "..." } ]

NO incluyas markdown, ni bloques de código (\`\`\`json), solo el JSON crudo.
`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.extractMetadata = async (imagePath) => {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: { responseMimeType: "application/json" },
    systemInstruction: METADATA_PROMPT,
  });

  try {
    const imageBuffer = await fs.readFile(imagePath);
    const result = await model.generateContent([
      "Extrae los metadatos de la cabecera.",
      {
        inlineData: {
          data: imageBuffer.toString("base64"),
          mimeType: "image/png",
        },
      },
    ]); // Note: mimeType updated to png as per imageService change
    return JSON.parse(result.response.text());
  } catch (error) {
    console.error("Error extracting metadata:", error);
    return { numero_boletin: "Desconocido", fecha_publicacion: "Desconocido" };
  }
};

exports.extractEntries = async (imagePaths, jsonDir, onProgress) => {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: { responseMimeType: "application/json" },
    systemInstruction: ENTRIES_PROMPT,
  });

  const results = [];

  for (let i = 0; i < imagePaths.length; i++) {
    const imgPath = imagePaths[i];
    // Offset page num logic to be actual page number depending on input array
    // Since input array is pages 2..N, we map index to page ID.
    // However, imagePaths here will be passed as sliced array?
    // Let's rely on filename parsing in controller later, or just return objects.
    const pageFileName = path.basename(imgPath);
    const pageNumMatch = pageFileName.match(/(?:page_|page\.)(\d+)/);
    const pageNum = pageNumMatch ? parseInt(pageNumMatch[1]) : i + 1;

    try {
      console.log(`Processing entry page ${pageNum}...`);
      const imageBuffer = await fs.readFile(imgPath);

      const result = await model.generateContent([
        "Extrae las entradas de esta página.",
        {
          inlineData: {
            data: imageBuffer.toString("base64"),
            mimeType: "image/png",
          },
        },
      ]);

      const responseText = result.response.text();
      let jsonData;
      try {
        jsonData = JSON.parse(responseText);
      } catch (e) {
        jsonData = []; // Fail safe to empty array for aggregation
      }

      // Save individual JSON
      // Remove explicit JSON saving for pages as requested
      // const jsonPath = path.join(jsonDir, `page_${pageNum}.json`);
      // await fs.writeJson(jsonPath, jsonData, { spaces: 2 });

      // Attach page number to result for consolidation
      results.push({ page: pageNum, entries: jsonData });

      // Trigger progress callback
      if (onProgress) onProgress();

      await delay(1000);
    } catch (error) {
      console.error(`Error processing page ${pageNum}:`, error);
    }
  }
  return results;
};

// Deprecating old function or mapping it
exports.extractDataFromImages = async (imagePaths, jsonDir) => {
  // This was the old signature. We should not use it anymore in new controller logic.
  // But to avoid breaking if referenced:
  return exports.extractEntries(imagePaths, jsonDir);
};
