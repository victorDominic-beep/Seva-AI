# Frontend Integration Guide — Seva AI v1.0 with PDF Support

## Quick Update for Frontend Dev

### 1. **Response Format (IMPORTANT)**

The backend now returns responses in this structure. Store the **entire object** including `assistantMessage`:

```javascript
{
  query: "user question",
  intent: "SAVE_MORE" | "PDF_FALLBACK" | "GREETING" | etc,
  isGreeting: boolean,
  isHandoff: boolean,
  isPDFFallback: boolean,
  insight: "explanation part",
  meaning: "why it matters",
  action: "what to do",
  displayText: "full response text",
  suggestedPrompts: [...],
  assistantMessage: {
    role: "assistant",
    content: "raw LLM response"  // ← SAVE THIS for conversation history
  },
  requestTime: "ISO timestamp",
  responseTime: "ISO timestamp",
  durationMs: number
}
```

### 2. **Conversation History Storage (LocalStorage)**

Save each message pair to localStorage for continuity:

```javascript
// On page load, retrieve history:
const conversationHistory = JSON.parse(localStorage.getItem("sevaHistory")) || [];

// When user sends a message, add both user and assistant messages:
const userMsg = {
  role: "user",
  content: userQuery,
  text: userQuery  // For compatibility
};

const assistantMsg = response.assistantMessage;  // From backend response

conversationHistory.push(userMsg);
conversationHistory.push(assistantMsg);

// Save to localStorage:
localStorage.setItem("sevaHistory", JSON.stringify(conversationHistory));

// Send history with next request:
fetch("/api/chat", {
  method: "POST",
  body: JSON.stringify({
    message: nextQuery,
    userId: userId,
    conversationHistory: conversationHistory  // ← Send this to backend
  })
});
```

### 3. **Clearing History**

When user logs out or resets:

```javascript
localStorage.removeItem("sevaHistory");
conversationHistory = [];
```

### 4. **Key Changes**

- ✅ **PDF Integration Active** — Questions about "Savey" will now pull from your PDF
- ✅ **Conversation Memory** — Backend tracks history, you store it locally
- ✅ **Cleaner Responses** — No "according to document" phrases
- ✅ **Shorter Responses** — Tuned for mobile-friendly length

### 5. **Testing the PDF Feature**

Ask these questions to test PDF fallback:
- "What is Savey?"
- "Who is Savey?"
- "Tell me about Savey features"

If it returns info about Savey (from the PDF), the integration is working! ✅

---

## API Endpoint Reference

**POST** `/api/chat`

Request body:
```json
{
  "message": "user question",
  "userId": "user-id-or-demo",
  "conversationHistory": [
    { "role": "user", "content": "previous message" },
    { "role": "assistant", "content": "previous response" }
  ]
}
```

Response: See structure above

**GET** `/api/chat/pdf` — Check PDF index status

---

## Notes for Dev Team

- Store the **entire response object**, not just `displayText`
- The `assistantMessage` is critical for conversation memory
- PDF searches happen automatically on every query
- No need to refresh or reload for PDF updates
- PDF responses are seamless (user won't know it came from PDF)

---

**Questions?** Check the backend code in `sevaPipeline.js`, `retriever.js`, or `pdfService.js`
