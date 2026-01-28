const path = require("path");
const fs = require("fs-extra");
const { v4: uuidv4 } = require("uuid");
const { convertPdfToImages, cropImages } = require("../services/imageService");
const { extractDataFromImages } = require("../services/geminiService");

const generateRandomId = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

const axios = require("axios"); // Add axios import

exports.processPdf = async (req, res) => {
  let pdfPath;
  let originalName;
  let id6 = generateRandomId(); // Generate ID early for logs
  let cleanupTempDownload = false; // Flag to know if we need to clean up a downloaded file
  let sessionDir; // Declare sessionDir here scope

  try {
    if (req.file) {
      pdfPath = req.file.path;
      originalName = path.parse(req.file.originalname).name;
    } else if (
      req.body.pdf &&
      (req.body.pdf.startsWith("http://") ||
        req.body.pdf.startsWith("https://"))
    ) {
      // Handle URL
      const pdfUrl = req.body.pdf;
      console.log(`[${id6}] Downloading PDF from URL: ${pdfUrl}`);

      // Create a temp path
      const tempDownloadDir = path.join(__dirname, "../../temp_uploads");
      await fs.ensureDir(tempDownloadDir);

      // Try to get filename from URL or default
      const urlFileName =
        path.basename(pdfUrl).split(/[?#]/)[0] || "download.pdf";
      originalName = path.parse(urlFileName).name;
      pdfPath = path.join(tempDownloadDir, `${originalName}_${id6}_raw.pdf`);

      const response = await axios({
        method: "get",
        url: pdfUrl,
        responseType: "stream",
      });

      const writer = fs.createWriteStream(pdfPath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      cleanupTempDownload = true;
      console.log(`[${id6}] Download complete: ${pdfPath}`);
    } else {
      return res
        .status(400)
        .json({ error: "No PDF file uploaded or valid URL provided" });
    }

    sessionDir = path.join(
      __dirname,
      "../../uploads",
      `${originalName}_${id6}`,
    );
    const imagesDir = path.join(sessionDir, "images");
    const jsonDir = path.join(sessionDir, "json");

    // 1. Setup Directories
    await fs.ensureDir(imagesDir);
    await fs.ensureDir(jsonDir);

    console.log(`[${id6}] Starting processing for ${originalName}`);

    // 2. Convert PDF to Images
    // We move the uploaded (or downloaded) file to the session dir for safekeeping during process
    const safePdfPath = path.join(sessionDir, "source.pdf");
    await fs.move(pdfPath, safePdfPath);

    console.log(`[${id6}] Converting PDF to images...`);
    const imagePaths = await convertPdfToImages(safePdfPath, imagesDir);
    console.log(`[${id6}] Converted ${imagePaths.length} pages.`);

    // 3. Crop Images (Top 6%, Bottom 7.5%)
    console.log(`[${id6}] Cropping images...`);
    const croppedImagePaths = await cropImages(imagePaths);

    // 4. Send to Gemini
    console.log(`[${id6}] Extracting data with Gemini...`);
    const extractionResults = await extractDataFromImages(
      croppedImagePaths,
      jsonDir,
    );

    // 5. Consolidate Results
    const finalResult = extractionResults.reduce((acc, curr) => {
      // Assuming curr is an array of items or a single object.
      // The requirement says "une todos los arrays de JSON en uno solo".
      if (Array.isArray(curr)) {
        return acc.concat(curr);
      } else if (curr && typeof curr === "object") {
        // If the LLM returns an object wrapping a list, try to find the list.
        // Otherwise just push the object.
        // We'll normalize in the service, but here we just concat.
        return acc.concat([curr]);
      }
      return acc;
    }, []);

    // 6. Cleanup (Optional: remove temp images? User said "limpia los archivos temporales si es posible")
    // We keep the structure as requested: uploads/{pdfName}_{id6}/images but maybe we delete the whole thing after response?
    // "clean up temporary files" usually means the ones not needed for the record.
    // The prompt says "structure folders: uploads/..." implying they might want to inspect them?
    // But "Respuesta: Devuelve el JSON final y limpia los archivos temporales si es posible." suggests full cleanup.
    // I will delete the entire session folder after sending response to be clean.
    await fs.remove(sessionDir);

    res.json({
      success: true,
      data: finalResult,
    });
  } catch (error) {
    console.error(`[${id6}] Error processing PDF:`, error);
    res.status(500).json({ error: error.message });
    // Attempt cleanup on error
    try {
      if (sessionDir && (await fs.pathExists(sessionDir))) {
        await fs.remove(sessionDir);
      }
      if (await fs.pathExists(pdfPath)) {
        // If move failed
        await fs.remove(pdfPath);
      }
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr);
    }
  }
};
