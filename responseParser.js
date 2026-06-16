// src/responseParser.js
// -------------------------------------------------------------------
// SAVEY AI — Response Parser
// Role: Takes the raw LLM text and extracts the structured parts
//       (insight, meaning, action, CTAs) so the frontend can render
//       them correctly in the chat UI.
// -------------------------------------------------------------------

// ── CTA JSON extractor ───────────────────────────────────────────────
function extractCTAs(rawText) {
  try {
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[1].trim());
    return parsed.ctas || [];
  } catch {
    return [];
  }
}

// ── Strip JSON block from text ───────────────────────────────────────
function stripCTABlock(rawText) {
  return rawText.replace(/```json[\s\S]*?```/g, "").trim();
}

// ── Section extractor ────────────────────────────────────────────────
// Tries to find INSIGHT / MEANING / ACTION sections from the response.
// If the LLM formats them differently, we fall back to splitting by lines.
function extractSections(cleanText) {
  const sections = { insight: "", meaning: "", action: "" };

  // Try labelled sections first
  const insightMatch = cleanText.match(/INSIGHT[:\s]+(.*?)(?=MEANING|ACTION|$)/si);
  const meaningMatch = cleanText.match(/MEANING[:\s]+(.*?)(?=ACTION|$)/si);
  const actionMatch  = cleanText.match(/ACTION[:\s]+(.*?)$/si);

  if (insightMatch) sections.insight = insightMatch[1].trim();
  if (meaningMatch) sections.meaning = meaningMatch[1].trim();
  if (actionMatch)  sections.action  = actionMatch[1].trim();

  // Fallback: if no labels found, split paragraphs
  if (!sections.insight) {
    const paras = cleanText.split(/\n\n+/).filter(Boolean);
    sections.insight = paras[0] || cleanText;
    sections.meaning = paras[1] || "";
    sections.action  = paras[2] || "";
  }

  return sections;
}

// ── Main parser ──────────────────────────────────────────────────────
function parseResponse(rawLLMResponse) {
  const ctas      = extractCTAs(rawLLMResponse);
  const cleanText = stripCTABlock(rawLLMResponse);
  const sections  = extractSections(cleanText);

  return {
    raw: rawLLMResponse,
    insight: sections.insight,
    meaning: sections.meaning,
    action:  sections.action,
    ctas,
    // Convenience: full clean text for simple chat display
    displayText: cleanText
  };
}

module.exports = { parseResponse };
