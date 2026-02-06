const path = require("path");
const fs = require("fs-extra");
const { v4: uuidv4 } = require("uuid");
const { convertPdfToImages, cropImages } = require("../services/imageService");
const { extractDataFromImages } = require("../services/geminiService");

const generateRandomId = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

const axios = require("axios"); // Add axios import

// In-memory job store
const activeJobs = new Map();

exports.getProcessingStatus = (req, res) => {
  const jobs = Array.from(activeJobs.values());
  res.json(jobs);
};

exports.cancelProcess = (req, res) => {
  const { id } = req.body;
  let cancelledCount = 0;

  if (id) {
    if (activeJobs.has(id)) {
      const job = activeJobs.get(id);
      // Only cancel if it's currently processing or in queue (if we had one)
      if (job.status === "processing") {
        job.status = "cancelled";
        job.isCancelled = true;
        cancelledCount++;
      }
      return res.json({ success: true, message: `Process ${id} cancelled` });
    } else {
      return res.status(404).json({ error: "Process not found" });
    }
  } else {
    // Cancel all processing jobs
    for (const [key, job] of activeJobs) {
      if (job.status === "processing") {
        job.status = "cancelled";
        job.isCancelled = true;
        cancelledCount++;
      }
    }
    return res.json({
      success: true,
      message: `${cancelledCount} processes cancelled`,
    });
  }
};

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

    // Initialize Job Tracking
    activeJobs.set(id6, {
      id: id6,
      filename: originalName,
      totalPages: 0,
      processedPages: 0,
      status: "processing",
      startTime: new Date(),
    });

    console.log(`[${id6}] Starting processing for ${originalName}`);

    // 2. Convert PDF to Images
    // We move the uploaded (or downloaded) file to the session dir for safekeeping during process
    const safePdfPath = path.join(sessionDir, "source.pdf");
    await fs.move(pdfPath, safePdfPath);

    console.log(`[${id6}] Converting PDF to images...`);
    const imagePaths = await convertPdfToImages(safePdfPath, imagesDir);
    if (!activeJobs.has(id6) || activeJobs.get(id6).isCancelled)
      throw new Error("Process cancelled by user");
    console.log(`[${id6}] Converted ${imagePaths.length} pages.`);

    // Update Job Total Pages
    if (activeJobs.has(id6)) {
      activeJobs.get(id6).totalPages = imagePaths.length;
    }

    // 3. Crop Images (Top 6%, Bottom 7.5%)
    console.log(`[${id6}] Cropping images...`);
    const croppedImagePaths = await cropImages(imagePaths);
    if (!activeJobs.has(id6) || activeJobs.get(id6).isCancelled)
      throw new Error("Process cancelled by user");

    // 4. Send to Gemini
    console.log(`[${id6}] Extracting data with Gemini...`);

    // Split operations:
    // Page 1: Metadata Extraction
    const {
      extractMetadata,
      extractEntries,
    } = require("../services/geminiService");

    let boletinMetadata = {
      numero_boletin: "Desconocido",
      fecha_publicacion: "Desconocido",
      entry_pages: [],
      total_pages: 0,
    };

    // Extract metadata from first page
    if (croppedImagePaths.length > 0) {
      console.log(`[${id6}] Extracting metadata from Page 1...`);
      const meta = await extractMetadata(croppedImagePaths[0]);
      boletinMetadata = { ...boletinMetadata, ...meta };
      boletinMetadata.total_pages = croppedImagePaths.length;

      // Update progress for Page 1
      if (activeJobs.has(id6)) {
        activeJobs.get(id6).processedPages += 1;
      }
    }

    if (!activeJobs.has(id6) || activeJobs.get(id6).isCancelled)
      throw new Error("Process cancelled by user");

    // Process entries (Pages 2 to N) as requested "remueve la primera pagina de las entradas"
    // Wait... if user meant "remove first page from entries", implies entries start page 2.
    // If we skip page 1 entirely for entries, we pass croppedImagePaths.slice(1)
    const entryImagePaths = croppedImagePaths.slice(1);

    // Keep track of which original pages correspond to these
    // Since we sliced 1, index 0 here is page 2.
    // We'll let the service handle file writing, but we need to track pages.

    console.log(
      `[${id6}] Extracting entries from ${entryImagePaths.length} pages...`,
    );
    const extractionResults = await extractEntries(
      entryImagePaths,
      jsonDir,
      () => {
        // Progress Callback
        if (activeJobs.has(id6)) {
          const job = activeJobs.get(id6);
          if (job.isCancelled) throw new Error("Process cancelled by user");
          job.processedPages += 1;
        }
      },
      () => {
        // Check Cancelled Callback
        if (activeJobs.has(id6)) {
          return activeJobs.get(id6).isCancelled;
        }
        return true; // Cancel if job is missing
      },
    );

    // 5. Consolidate Results (ACTOS aggregation)
    const actos = [];
    let currentSection = "";
    let currentAct = null;

    // Helper for normalization
    const normalizeSectionTitle = (title) => {
      if (!title) return "Sección Desconocida";
      let cleaned = title.replace(/\s+/g, " ").trim();
      cleaned = cleaned.toLowerCase();
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    };

    const sectionStats = {};

    // Helper to finalize an act
    const finalizeAct = () => {
      if (currentAct) {
        // Normalize section title
        const normSection = normalizeSectionTitle(currentAct.section);
        currentAct.section = normSection;

        // Update stats
        if (!sectionStats[normSection]) {
          sectionStats[normSection] = 0;
        }
        sectionStats[normSection]++;

        actos.push(currentAct);
        currentAct = null;
      }
    };

    // Flatten all page results into a single stream of items
    // results is [{ page: 2, entries: [...] }, ...]
    const allItems = [];
    extractionResults.forEach((res) => {
      if (res.entries && Array.isArray(res.entries)) {
        boletinMetadata.entry_pages.push(res.page);
        // Inject page number
        res.entries.forEach((entry) => (entry.page = res.page));
        allItems.push(...res.entries);
      }
    });

    // Per user request: "no borres los json d elas respuestas, mantenlos fisicamente, a la respuesta generarl y por pagina"
    // We already keep them physically (commented out cleanup).
    // To add them to general response, we'll add a 'raw_pages' field.
    const rawPages = extractionResults.map((res) => ({
      page: res.page,
      content: res.entries,
    }));

    // Iterate through items to build Acts
    for (const item of allItems) {
      if (item.type === "sectiontitle") {
        // Section title usually appears at start or middle.
        // It sets the CONTEXT for subsequent acts until changed.
        // It DOES NOT necessarily start a new act itself, but acts belong to it.
        // Actually, requirement: "section: seccion actual, siempre es el ultimo section title."
        currentSection = item.content;
      } else if (item.type === "entrietitle") {
        // Check for split title: If previous act is open, has NO content, and is same section context
        // we assume this title belongs to the previous one.
        if (
          currentAct &&
          currentAct.entrie_content.length === 0 &&
          currentAct.section === currentSection
        ) {
          // Merge titles
          currentAct.entrie_title += " " + item.content;
        } else {
          // New Act starts here.
          finalizeAct(); // Close previous
          currentAct = {
            section: currentSection,
            entrie_title: item.content,
            entrie_content: [],
            page: item.page,
          };
        }
      } else if (item.type === "entrietext") {
        // Content for current act
        if (currentAct) {
          currentAct.entrie_content.push(item);
        } else {
          // Orphan text? Maybe belongs to previous section header acting as act?
          // Or maybe we treat it as an act with no title?
          // For now, prompt implies entrietitle starts it.
          // If we have text with no act, we might create a generic one or append to previous if logical.
          // Let's create a "Sin Título" act if strictly needed or log warning.
          // Better: Create dummy act if null.
          if (!currentAct) {
            currentAct = {
              section: currentSection,
              entrie_title: "SIN TÍTULO DETECTADO",
              entrie_content: [],
            };
          }
          currentAct.entrie_content.push(item);
        }
      }
    }
    finalizeAct(); // Close last act

    // Add stats to metadata
    boletinMetadata.sections = Object.keys(sectionStats).map((key) => ({
      name: key,
      acts_count: sectionStats[key],
    }));
    boletinMetadata.total_actos = actos.length;

    const finalResponse = {
      success: true,
      boletin_metadata: boletinMetadata,
      actos: actos,
      raw_pages: rawPages,
    };

    // Retain job in memory for polling clients (5 minutes retention)
    if (activeJobs.has(id6)) {
      const job = activeJobs.get(id6);
      job.status = "completed";
      job.processedPages = job.totalPages; // Ensure 100%
      job.result = finalResponse; // Store full result
      job.completedAt = new Date();

      console.log(`[${id6}] Job set to completed. Retaining for 5 minutes.`);

      setTimeout(
        () => {
          activeJobs.delete(id6);
          console.log(
            `[${id6}] Job removed from memory after retention period.`,
          );
        },
        5 * 60 * 1000,
      );
    }

    // Remove logic for writing final_response.json as requested

    // 6. Cleanup
    // 6. Cleanup
    try {
      if (sessionDir && (await fs.pathExists(sessionDir))) {
        await fs.remove(sessionDir);
      }
      // Ensure original file is gone too if it wasn't moved or if it remains for some reason
      if (pdfPath && (await fs.pathExists(pdfPath))) {
        await fs.remove(pdfPath);
      }
    } catch (err) {
      console.error(`[${id6}] Error cleaning up session dir:`, err);
    }

    // Update status to completed instead of deleting
    if (activeJobs.has(id6)) {
      const job = activeJobs.get(id6);
      job.status = "completed";
      job.completedAt = new Date();
      // Store a summary or the full result if needed by the frontend polling
      job.result = finalResponse;
    }

    console.log(`[${id6}] Processing completed successfully.`);

    res.json(finalResponse);
  } catch (error) {
    console.error(`[${id6}] Error processing PDF:`, error);

    // Update status to error
    // Update status to error or cancelled
    if (activeJobs.has(id6)) {
      const job = activeJobs.get(id6);
      if (error.message === "Process cancelled by user") {
        job.status = "cancelled";
        console.log(`[${id6}] Process was cancelled.`);
      } else {
        job.status = "error";
        job.error = error.message;
      }
      job.failedAt = new Date();
    }

    res.status(500).json({ error: error.message });

    // Attempt cleanup on error
    try {
      if (sessionDir && (await fs.pathExists(sessionDir))) {
        await fs.remove(sessionDir);
      }
      if (pdfPath && (await fs.pathExists(pdfPath))) {
        await fs.remove(pdfPath);
      }
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr);
    }
  }
};
