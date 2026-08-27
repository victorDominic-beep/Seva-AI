// pdfService.js — PDF Document Management & Search
// ────────────────────────────────────────────────────────────
// Handles loading, parsing, indexing, and searching PDF documents
// Used as fallback when user question is out of AI's financial scope

const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");

// Store loaded PDF documents in memory with metadata
const pdfIndex = new Map(); // Map<pdfName, { chunks, metadata, fullText }>

// ── Initialize PDF storage folder ────────────────────────────
const PDF_STORAGE_DIR = process.env.PDF_STORAGE_DIR || path.join(__dirname, "pdfs");
if (!fs.existsSync(PDF_STORAGE_DIR)) {
  fs.mkdirSync(PDF_STORAGE_DIR, { recursive: true });
  console.log(`📁 Created PDF storage directory: ${PDF_STORAGE_DIR}`);
}

// ── Split text into chunks for better retrieval ───────────────
function chunkText(text, chunkSize = 500, overlap = 100) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkSize;

    // Try to end at a sentence boundary
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf(".", end);
      const lastNewline = text.lastIndexOf("\n", end);
      const boundary = Math.max(lastPeriod, lastNewline);
      if (boundary > start + chunkSize / 2) {
        end = boundary + 1;
      }
    }

    chunks.push({
      content: text.slice(start, end).trim(),
      startIndex: start,
      endIndex: end,
    });

    start = end - overlap;
  }

  return chunks;
}

// ── Load and parse a single PDF file ─────────────────────────
async function loadPDFFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`PDF file not found: ${filePath}`);
    }

    console.log(`📄 Loading PDF: ${path.basename(filePath)}`);
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);

    const fileName = path.basename(filePath, ".pdf");
    const fullText = pdfData.text;
    const chunks = chunkText(fullText);

    pdfIndex.set(fileName, {
      chunks,
      fullText,
      metadata: {
        fileName,
        pages: pdfData.numpages,
        loadedAt: new Date().toISOString(),
        fileSize: fs.statSync(filePath).size,
      },
    });

    console.log(`✅ Indexed PDF: "${fileName}" (${pdfData.numpages} pages, ${chunks.length} chunks)`);
    return { success: true, fileName, pages: pdfData.numpages, chunks: chunks.length };
  } catch (error) {
    console.error(`❌ Error loading PDF: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ── Load all PDFs from storage directory ──────────────────────
async function loadAllPDFs() {
  try {
    const files = fs.readdirSync(PDF_STORAGE_DIR).filter(f => f.endsWith(".pdf"));

    if (files.length === 0) {
      console.log("⚠️  No PDF files found in storage directory");
      return [];
    }

    console.log(`\n📚 Loading ${files.length} PDF(s) from ${PDF_STORAGE_DIR}...\n`);
    const results = [];

    for (const file of files) {
      const filePath = path.join(PDF_STORAGE_DIR, file);
      const result = await loadPDFFile(filePath);
      results.push(result);
    }

    console.log(`\n✨ PDF indexing complete. ${pdfIndex.size} document(s) ready.\n`);
    return results;
  } catch (error) {
    console.error(`Error loading PDFs: ${error.message}`);
    return [];
  }
}

// ── Search PDFs for relevant content ────────────────────────
function searchPDFs(query, maxResults = 3) {
  if (pdfIndex.size === 0) {
    return { found: false, results: [], message: "No PDFs indexed" };
  }

  // ★ IMPROVED — Extract keywords, filter stop words but keep important ones
  const stopWords = new Set([
    "what", "who", "which", "where", "when", "why", "how",
    "is", "are", "am", "be", "been", "being", "a", "an", "the",
    "and", "or", "but", "in", "on", "at", "to", "for", "of", "with"
  ]);

  let queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 2 && !stopWords.has(t));

  // If all words were filtered out, use all non-tiny words
  if (queryTerms.length === 0) {
    queryTerms = query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 2);
  }

  console.log(`   [PDF Search] Terms: [${queryTerms.join(", ")}]`);

  const results = [];

  // Search all indexed PDFs
  pdfIndex.forEach((pdfData, pdfName) => {
    pdfData.chunks.forEach((chunk, chunkIndex) => {
      const chunkLower = chunk.content.toLowerCase().replace(/[^a-z0-9]+/g, " ");
      let relevanceScore = 0;

      // Calculate relevance based on query term matches
      queryTerms.forEach(term => {
        const matches = chunkLower.split(term).length - 1;
        relevanceScore += matches;
      });

      // Include any chunks with matches
      if (relevanceScore > 0) {
        results.push({
          source: pdfName,
          chunkIndex,
          content: chunk.content.substring(0, 300),
          relevance: relevanceScore,
          metadata: pdfData.metadata,
        });
      }
    });
  });

  // Sort by relevance and return top results
  results.sort((a, b) => b.relevance - a.relevance);
  const topResults = results.slice(0, maxResults);

  console.log(`   [PDF Search] Found ${results.length} matches (returning ${topResults.length})`);

  return {
    found: topResults.length > 0,
    results: topResults,
    totalMatches: results.length,
    query,
  };
}

// ── Check if content is relevant to a query ──────────────────
function isContentRelevant(query, searchResults, relevanceThreshold = 0) {
  if (!searchResults.found || searchResults.results.length === 0) {
    return false;
  }

  // Consider relevant if any result has relevance score > threshold
  return searchResults.results.some(result => result.relevance > relevanceThreshold);
}

// ── Get PDF index status ─────────────────────────────────────
function getPDFStatus() {
  const status = {
    indexedCount: pdfIndex.size,
    documents: [],
  };

  pdfIndex.forEach((pdfData, pdfName) => {
    status.documents.push({
      name: pdfName,
      pages: pdfData.metadata.pages,
      chunks: pdfData.chunks.length,
      loadedAt: pdfData.metadata.loadedAt,
    });
  });

  return status;
}

// ── Upload a PDF file (for API endpoint) ─────────────────────
async function uploadPDF(filePath, fileName) {
  try {
    const destPath = path.join(PDF_STORAGE_DIR, fileName);
    if (!fileName.endsWith(".pdf")) {
      throw new Error("Only PDF files are allowed");
    }

    // Copy file to storage directory
    fs.copyFileSync(filePath, destPath);
    console.log(`📤 PDF uploaded: ${fileName}`);

    // Load and index immediately
    const result = await loadPDFFile(destPath);
    return result;
  } catch (error) {
    console.error(`Error uploading PDF: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ── Clear all indexed PDFs ───────────────────────────────────
function clearPDFIndex() {
  pdfIndex.clear();
  console.log("🗑️  PDF index cleared");
  return { cleared: true };
}

// ── Get full PDF content ─────────────────────────────────────
function getPDFContent(pdfName) {
  const pdfData = pdfIndex.get(pdfName);
  if (!pdfData) {
    return { found: false, message: `PDF not found: ${pdfName}` };
  }

  return {
    found: true,
    name: pdfName,
    pages: pdfData.metadata.pages,
    content: pdfData.fullText,
    loadedAt: pdfData.metadata.loadedAt,
  };
}

module.exports = {
  loadPDFFile,
  loadAllPDFs,
  searchPDFs,
  isContentRelevant,
  getPDFStatus,
  uploadPDF,
  clearPDFIndex,
  getPDFContent,
};
