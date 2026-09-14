// responseParser.js — Seva AI v4.0 (With PDF Citation Support)
// ────────────────────────────────────────────────────────────
// Extracts insight, meaning, action from LLM responses
// Handles PDF source attribution for fallback responses
// ────────────────────────────────────────────────────────────

function extractSections(cleanText) {
  const sections = { insight: "", meaning: "", action: "" };

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

function parseResponse(rawLLMResponse, pdfSources = null) {
  const cleanText = rawLLMResponse.trim();
  const sections   = extractSections(cleanText);

  return {
    raw: rawLLMResponse,
    insight: sections.insight,
    meaning: sections.meaning,
    action:  sections.action,
    displayText: cleanText
  };
}

module.exports = { parseResponse };
