import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getJson } from "serpapi";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ── Validate Keys ─────────────────────────────────────────────────────────────

if (!process.env.GEMINI_API_KEY) {
  console.error("❌  GEMINI_API_KEY missing in .env");
  process.exit(1);
}
if (!process.env.SERPAPI_KEY) {
  console.error("❌  SERPAPI_KEY missing in .env");
  process.exit(1);
}

// ── Gemini Setup ──────────────────────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: {
    temperature: 0.5,
    maxOutputTokens: 800,
  },
});

// ── Store Policies ────────────────────────────────────────────────────────────

const POLICIES = `
Returns & Replacement: Within 7 days of delivery.
Refund: Processed within 5 working days.
Damaged Product: Contact support within 48 hours with photos.
Cancellation: Before the order is shipped.
Free Shipping: On orders above ₹999.
Delivery Time: 3–7 business days across India.
Payment: UPI, Debit/Credit Card, Net Banking, Cash on Delivery.
International Shipping: Not available. India only.
Contact: support@stylebot.com | +91-9876543210 | Mon–Sat 9AM–6PM IST
`.trim();

// ── Detect if message needs a product search ──────────────────────────────────

const SEARCH_KEYWORDS = [
  "show", "find", "search", "looking for", "want", "need", "suggest",
  "recommend", "buy", "shop", "get me", "where can i", "price of",
  "pant", "shirt", "jacket", "hoodie", "sneaker", "shoe", "kurta",
  "dress", "top", "jeans", "jogger", "tee", "outfit", "clothes",
  "clothing", "wear", "style", "fashion", "under ₹", "under rs",
  "budget", "cheap", "affordable", "best",
];

function needsProductSearch(message) {
  const lower = message.toLowerCase();
  return SEARCH_KEYWORDS.some((kw) => lower.includes(kw));
}

// ── SerpAPI — search Indian fashion stores ────────────────────────────────────

const FASHION_SITES = "site:myntra.com OR site:ajio.com OR site:meesho.com OR site:flipkart.com OR site:amazon.in OR site:snitch.co.in";

async function searchProducts(query) {
  try {
    const results = await getJson({
      engine: "google",
      q: `${query} ${FASHION_SITES}`,
      api_key: process.env.SERPAPI_KEY,
      gl: "in",        // India
      hl: "en",
      num: 6,
    });

    const items = results.organic_results || [];

    return items.slice(0, 5).map((item) => ({
      title: item.title,
      link:  item.link,
      store: extractStoreName(item.link),
      snippet: item.snippet || "",
    }));

  } catch (err) {
    console.error("SerpAPI error:", err?.message || err);
    return [];
  }
}

function extractStoreName(url = "") {
  if (url.includes("myntra"))  return "Myntra";
  if (url.includes("ajio"))    return "Ajio";
  if (url.includes("meesho"))  return "Meesho";
  if (url.includes("flipkart")) return "Flipkart";
  if (url.includes("amazon"))  return "Amazon";
  if (url.includes("snitch"))  return "Snitch";
  return "Online Store";
}

// ── Build Gemini Prompt ───────────────────────────────────────────────────────

function buildPrompt(userMessage, products, conversationContext) {
  const isProductQuery = products.length > 0;

  const productSection = isProductQuery
    ? `
━━ LIVE SEARCH RESULTS ━━
The following products were found online for the user's query. 
Use these to write your reply. For each product write:
- A short 1-line style description
- The store name and the link

${products.map((p, i) => `
Product ${i + 1}:
Title: ${p.title}
Store: ${p.store}
Link: ${p.link}
Details: ${p.snippet}
`).join("\n")}
`
    : "";

  const context = conversationContext
    ? `━━ CONVERSATION SO FAR ━━\n${conversationContext}\n\n`
    : "";

  return `
You are StyleBot, a warm and helpful Indian fashion assistant.

━━ YOUR STYLE ━━
- Friendly, concise, use simple Indian English.
- For product results: present each item with a short style tip, the store name, and the link clearly.
- Format each product like this (use this exact format):

👕 [Product Name]
[One line style description — what to pair it with, occasion, etc.]
🏪 [Store Name] → [link]

- After listing products, add a short 1-line style tip at the end.
- For policy/support questions: answer in 1–2 lines directly.
- Never make up links or products. Only use what's provided in LIVE SEARCH RESULTS.
- If no products found, apologize and suggest the user search directly on Myntra or Ajio.
- Do not use markdown headers (#). Use plain text, bullets, and the format above.

━━ STORE POLICIES ━━
${POLICIES}

${productSection}
${context}User: ${userMessage}
StyleBot:
`.trim();
}

// ── Session History ───────────────────────────────────────────────────────────

const sessions = new Map();

function getHistory(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
}

// ── /chat Route ───────────────────────────────────────────────────────────────

app.post("/chat", async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message is required." });
  }
  if (message.trim().length > 500) {
    return res.status(400).json({ error: "Message is too long." });
  }

  const sid = sessionId || "default";
  const history = getHistory(sid);

  const conversationContext = history
    .map((t) => `User: ${t.user}\nStyleBot: ${t.bot}`)
    .join("\n\n");

  // Step 1 — search products if needed
  let products = [];
  if (needsProductSearch(message.trim())) {
    console.log(`🔍 Searching: "${message.trim()}"`);
    products = await searchProducts(message.trim());
    console.log(`✅ Found ${products.length} products`);
  }

  // Step 2 — build prompt and call Gemini
  const prompt = buildPrompt(message.trim(), products, conversationContext);

  try {
    const result = await model.generateContent(prompt);
    const reply = result.response.text().trim();

    history.push({ user: message.trim(), bot: reply });
    if (history.length > 10) history.shift();

    return res.json({ reply, sessionId: sid });

  } catch (err) {
    console.error("Gemini error:", err?.message || err);

    if (err?.status === 429) {
      return res.status(429).json({
        reply: "Too many requests right now. Please try again in a moment! 🙏",
      });
    }

    return res.status(500).json({
      reply: "Something went wrong. Please contact support at support@stylebot.com.",
    });
  }
});

// ── Health Check ──────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found." });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅  StyleBot running → http://localhost:${PORT}`);
});