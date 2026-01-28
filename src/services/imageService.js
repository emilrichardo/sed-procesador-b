const sharp = require("sharp");
const path = require("path");
const fs = require("fs-extra");
const { fromPath } = require("pdf2pic");

// Optimize Sharp for M1 (it usually auto-detects, but good practice to ensure concurrency)
sharp.concurrency(0); // 0 means use all available cores

exports.convertPdfToImages = async (pdfPath, outputDir) => {
  // pdf2pic options - High Quality optimized for OCR
  const options = {
    density: 600, // Doubled density for sharper text
    saveFilename: "page",
    savePath: outputDir,
    format: "png", // PNG is lossless, better for Text/OCR
    width: 4960, // A4 @ 600dpi approx (doubled)
    height: 7016,
  };

  try {
    const convert = fromPath(pdfPath, options);
    // pdf2pic's bulk is handy: convert.bulk(-1) converts all pages
    const result = await convert.bulk(-1, { responseType: "image" });

    // Result is array of objects with path, etc.
    // Normalized to absolute paths
    return result.map((r) => r.path);
  } catch (error) {
    console.error("pdf2pic error:", error);
    throw new Error(
      "Failed to convert PDF to images. Ensure GraphicsMagick and Ghostscript are installed (brew install graphicsmagick ghostscript).",
    );
  }
};

exports.cropImages = async (imagePaths) => {
  const croppedPaths = [];

  for (const imgPath of imagePaths) {
    const filename = path.basename(imgPath);
    // Overwrite or create new? Let's overwrite or suffix.
    // Requirement: "Exporta como page_NN.jpg en alta calidad" - pdf2pic already names them page_NN.jpg.
    // We need to crop them. Let's do in-place or separate?
    // "Implementa el recorte dinámico... Exporta como page_NN.jpg".
    // Since pdf2pic created them, let's just process them and save them back.

    const image = sharp(imgPath);
    const metadata = await image.metadata();

    const width = metadata.width;
    const height = metadata.height;

    // topCrop: 6%
    // bottomCrop: 7.5%
    const top = Math.round(height * 0.06);
    const bottomToRemove = Math.round(height * 0.075);
    const extractHeight = height - top - bottomToRemove;

    const buffer = await image
      .extract({ left: 0, top: top, width: width, height: extractHeight })
      .sharpen() // Apply mild sharpening to help OCR
      .png({ compressionLevel: 5 }) // Use PNG for output too
      .toBuffer();

    await fs.writeFile(imgPath, buffer);
    croppedPaths.push(imgPath);
  }

  return croppedPaths;
};
