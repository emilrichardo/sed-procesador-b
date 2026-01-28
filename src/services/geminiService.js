const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs-extra");
const path = require("path");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `
Tu misión es una extracción quirúrgica del layout. El documento tiene una barrera horizontal INSALTABLE: el título 'SECCIÓN AVISOS VARIOS'.

INSTRUCCIONES DE FLUJO ESTRICTO:
1. BLOQUE SUPERIOR: Procesa las 3 columnas de arriba de izquierda a derecha COMPLETAMENTE. No pases al bloque inferior hasta terminar las firmas de los ministros de la franja de arriba.
2. DIVISOR: Identifica 'T I T U L O  D E  S E C C I O N' como el único 'sectiontitle'.
3. BLOQUE INFERIOR: Solo después del divisor, procesa las columnas de abajo.

REGLAS DE CLASIFICACIÓN:
- 'sectiontitle': Solo títulos que cruzan las 3 columnas con interletrado ancho.  Texto en MAYÚSCULAS con mucho espacio entre cada letra (interletrado) y un espacio en blanco significativo arriba y abajo (ej: NOTIFICACIONES CATASTRALES , AVISOS VARIOS, SECCIÓN JUDICIAL, SECCIÓN AVISOS DE HOY)
- 'entrietitle': Encabezados de decretos o nombres de entidades, Títulos en MAYÚSCULAS y siempre en Negrita que inician un nuevo bloque de información y tienen un espacio en blanco superior que los separa del texto anterior y nunca esl la continuación de un parrafo, (no son válidos: EL SEÑOR GOBERNADOR DE LA PROVINCIA, ORDEN DEL DIA SANTIAGO DEL ESTERO, PLAZOS DE EJECUCION, GOBIERNO PROVINCIAL, EL SEÑOR GOBERNADOR DE LA PROVINCIA)) .
- 'entrietext': Todo el cuerpo legal, incluyendo las firmas finales (nombres de ministros).

Formato: [ { "type": "...", "content": "..." } ]

NO incluyas markdown, ni bloques de código (\`\`\`json), solo el JSON crudo.
`;

// Helper to wait
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.extractDataFromImages = async (imagePaths, jsonDir) => {
  // Use 'gemini-2.0-flash' or 'gemini-1.5-flash' depending on availability.
  // User asked for "Gemini 2.0 Flash". Model name usually "gemini-2.0-flash-exp" or similar if preview.
  // Assuming "gemini-2.0-flash" is the valid identifier requested.
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: { responseMimeType: "application/json" },
    systemInstruction: SYSTEM_PROMPT,
  });

  const results = [];

  // Sequential processing
  for (let i = 0; i < imagePaths.length; i++) {
    const imgPath = imagePaths[i];
    const pageNum = i + 1;

    try {
      console.log(`Processing page ${pageNum}/${imagePaths.length}...`);

      const imageBuffer = await fs.readFile(imgPath);
      const prompt =
        "Analiza esta imagen y extrae los datos según el prompt del sistema.";

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: imageBuffer.toString("base64"),
            mimeType: "image/jpeg",
          },
        },
      ]);

      const responseText = result.response.text();
      let jsonData;
      try {
        jsonData = JSON.parse(responseText);
      } catch (e) {
        console.error(
          `Failed to parse JSON for page ${pageNum}:`,
          responseText,
        );
        jsonData = { error: "Failed to parse JSON", raw: responseText };
      }

      // Save individual JSON
      const jsonPath = path.join(jsonDir, `page_${pageNum}.json`);
      await fs.writeJson(jsonPath, jsonData, { spaces: 2 });

      results.push(jsonData);

      // Simple rate limit protection (optional but good practice)
      await delay(1000);
    } catch (error) {
      console.error(`Error processing page ${pageNum}:`, error);
      results.push({ error: error.message, page: pageNum });
    }
  }

  return results;
};
