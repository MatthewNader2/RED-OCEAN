// File: server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs/promises";
import multer from "multer"; // Added for file uploads
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// --- Initializations ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- Multer Configuration for Speech Input ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fieldSize: 10 * 1024 * 1024, // 10 MB
  },
});

// --- CACHING IMPLEMENTATION ---
let allProperties = [];
let dynamicFilters = { locations: [], types: [] };

// Immediately invoke the data initialization.
initializeData();

// --- Data Loading and Dynamic Filter Generation ---
async function initializeData() {
  console.log("Loading, processing, and caching property data...");
  try {
    const jsonData = await fs.readFile("./red ocean.json", "utf-8");
    allProperties = JSON.parse(jsonData).map((p, index) => ({
      ...p,
      uniqueId: index,
    }));

    const locations = new Set();
    const types = new Set();
    allProperties.forEach((p) => {
      if (p.Property.location) locations.add(p.Property.location);
      if (p.Property.type) types.add(p.Property.type);
    });
    dynamicFilters = {
      locations: [...locations],
      types: [...types],
    };
    console.log("Dynamic filters generated:", dynamicFilters);
    console.log("✅ Data has been successfully cached.");
  } catch (error) {
    console.error("----------- FAILED TO INITIALIZE DATA -----------", error);
    process.exit(1);
  }
}

app.use(cors());
app.use(express.json());

// --- Helper Functions ---
async function generateWithRetry(model, request, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const result = await model.generateContent(request);
      return result;
    } catch (error) {
      attempt++;
      console.warn(
        `API call failed on attempt ${attempt}/${maxRetries}. Error: ${error.message}`
      );
      if (attempt >= maxRetries) {
        console.error("API call failed after all retries.");
        throw error;
      }
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// --- Main Chat Logic ---
async function runConversation(userQuery, chatHistory) {
  let context = { last_suggestions: null, last_entity: null };
  if (chatHistory && chatHistory.length > 0) {
    const lastTurn = chatHistory[chatHistory.length - 1];
    if (lastTurn.role === "assistant") {
      if (lastTurn.suggestions && lastTurn.suggestions.length > 0) {
        context.last_suggestions = lastTurn.suggestions.map(
          (s) => s.Property.location
        );
      }
      if (lastTurn.entity) {
        context.last_entity = lastTurn.entity;
      }
    }
  }

  const systemPrompt = `You are a world-class real estate AI assistant. Your goal is to understand a user's request and convert it into a structured JSON object to control a smart filter system.

    ## CONTEXT
    - Previous Turn Suggestions: The user was just looking at properties in: ${
      JSON.stringify(context.last_suggestions) || "Nothing"
    }.
    - Last Discussed Entity: ${JSON.stringify(context.last_entity) || "None"}.
  
    ## AVAILABLE FILTERS
    - Locations: ${dynamicFilters.locations.join(", ")}
    - Types: ${dynamicFilters.types.join(", ")}
  
    ## INTENTS
    - SEARCH_UNITS: To find, get, or see a list of units.
    - ANALYZE_ENTITY: For questions ABOUT a location (e.g., "What do you know about Suite 57?").
    - UNIT_DETAILS: For follow-up questions about units in the context (e.g., "what is its payment plan?").
    - BEST_INVESTMENT_SEARCH: For "best investment" or "highest ROI".
    - LOWEST_RISK_SEARCH: For "safest investment" or "lowest risk".
  
    ## RESPONSE FORMAT (JSON ONLY)
    { "intent": "...", "parameters": { "location": "...", "type": "...", "sortBy": "...", "offset": 0 }, "thought": "..." }
  
    ## CRITICAL RULES
    1.  **Context is Key:** If the user says "their cheapest unit" and 'Last Discussed Entity' is '{ "location": "Suite 57" }', you MUST set the location parameter: \`"parameters": { "location": "Suite 57", "sortBy": "cheapest" }\`.
    2.  **Entity vs. Search:** "Tell me about Suite 95" -> ANALYZE_ENTITY. "Units in Suite 95" -> SEARCH_UNITS.
    3.  **Ranking:** "best investment" -> BEST_INVESTMENT_SEARCH. "lowest risk" -> LOWEST_RISK_SEARCH. "cheapest" -> SEARCH_UNITS with sortBy: 'cheapest'.
  
    ## User Query: "${userQuery}"`;

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Using stable model
  const planResult = await generateWithRetry(model, systemPrompt);
  const cleanedResponse = planResult.response
    .text()
    .trim()
    .replace(/```json/g, "")
    .replace(/```/g, "");
  const plan = JSON.parse(cleanedResponse);
  console.log("AI Plan:", plan);

  let executionResult;
  let summaryPrompt;
  let entityForNextTurn = null;

  switch (plan.intent) {
    case "SEARCH_UNITS":
      let candidates = [...allProperties];
      const params = plan.parameters;

      if (params.location) {
        candidates = candidates.filter(
          (p) =>
            p.Property.location &&
            new RegExp(params.location, "i").test(p.Property.location)
        );
        entityForNextTurn = { location: params.location };
      }
      if (params.type) {
        candidates = candidates.filter(
          (p) =>
            p.Property.type &&
            new RegExp(params.type, "i").test(p.Property.type)
        );
      }

      if (params.sortBy) {
        switch (params.sortBy) {
          case "most_expensive":
            candidates.sort(
              (a, b) =>
                (b.Property.priceRange.min || 0) -
                (a.Property.priceRange.min || 0)
            );
            break;
          case "cheapest":
            candidates.sort(
              (a, b) =>
                (a.Property.priceRange.min || Infinity) -
                (b.Property.priceRange.min || Infinity)
            );
            break;
        }
      }
      const offset = params.offset || 0;
      executionResult = candidates.slice(offset, offset + 5);
      summaryPrompt = `The user asked "${userQuery}". The filter returned these results. Formulate a friendly, human-like response summarizing the findings. Mention the top result specifically.\n\nDATA:\n${JSON.stringify(
        executionResult.map((p) => ({
          location: p.Property.location,
          price: p.Property.priceRange.min,
          type: p.Property.type,
        }))
      )}`;
      break;

    case "BEST_INVESTMENT_SEARCH":
      executionResult = [...allProperties]
        .sort(
          (a, b) =>
            (b.Property.roi.totalROI || 0) - (a.Property.roi.totalROI || 0)
        )
        .slice(0, 5);
      summaryPrompt = `The user asked for the best investment. The system found these properties with the highest Total ROI. Formulate a concise response highlighting the top result.\n\nDATA:\n${JSON.stringify(
        executionResult.map((p) => ({
          location: p.Property.location,
          totalROI: p.Property.roi.totalROI,
        }))
      )}`;
      break;

    case "LOWEST_RISK_SEARCH":
      const getRiskScore = (prop) => {
        let score = 0;
        if (prop.riskAssessment.marketRisk === "Low") score += 1;
        if (prop.riskAssessment.marketRisk === "Medium") score += 2;
        if (prop.riskAssessment.marketRisk === "High") score += 3;
        return score;
      };
      executionResult = [...allProperties]
        .sort((a, b) => getRiskScore(a.Property) - getRiskScore(b.Property))
        .slice(0, 5);
      summaryPrompt = `The user asked for the lowest risk investment. The system found these properties. Formulate a concise response highlighting the top result.\n\nDATA:\n${JSON.stringify(
        executionResult.map((p) => ({
          location: p.Property.location,
          marketRisk: p.Property.riskAssessment.marketRisk,
        }))
      )}`;
      break;

    case "ANALYZE_ENTITY":
      const entityName = plan.parameters.location;
      entityForNextTurn = { location: entityName };

      const matchingProps = allProperties.filter(
        (p) =>
          p.Property.location &&
          new RegExp(entityName, "i").test(p.Property.location)
      );
      if (matchingProps.length > 0) {
        executionResult = matchingProps;
        summaryPrompt = `The user asked about "${entityName}". Based ONLY on the following data, provide a detailed, human-like answer.\n\nDATA:\n${JSON.stringify(
          matchingProps[0].Property
        )}`;
      } else {
        executionResult = [];
        summaryPrompt = `The user asked about "${entityName}", but I couldn't find any data for it. Please inform the user politely.`;
      }
      break;

    case "UNIT_DETAILS":
      const lastSuggestions = chatHistory[chatHistory.length - 1]?.suggestions;
      if (lastSuggestions && lastSuggestions.length > 0) {
        const contextProp = lastSuggestions[0];
        executionResult = [contextProp];
        summaryPrompt = `The user asked a follow-up question: "${userQuery}". The context is this property's data. Based ONLY on this data, provide a direct, concise answer.\n\nCRITICAL RULE: If the provided DATA does not contain the answer, you MUST state that the information is not available.\n\nDATA:\n${JSON.stringify(
          contextProp.Property
        )}`;
      } else {
        executionResult = [];
        summaryPrompt = `The user asked a follow-up question, but there's no property in context. Politely ask them what they're referring to.`;
      }
      break;

    default:
      executionResult = [];
      summaryPrompt = `I'm not sure how to handle that request. Please ask the user to rephrase.`;
  }

  const summaryResult = await generateWithRetry(model, summaryPrompt);
  const summaryText = summaryResult.response.text().trim();

  return {
    summary: summaryText,
    suggestions: executionResult.slice(0, 3),
    entity: entityForNextTurn,
  };
}

// --- API Endpoints ---
app.get("/api/properties", (req, res) => {
  if (allProperties.length > 0) {
    res.json(allProperties);
  } else {
    res.status(503).json({ error: "Property data is not yet available." });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { userQuery, chatHistory } = req.body;
    if (!userQuery) {
      return res.status(400).json({ error: "userQuery is required" });
    }

    console.log(`\n--- New request on /api/chat (text) ---`);
    console.log(`Received query: ${userQuery}`);

    const { summary, suggestions, entity } = await runConversation(
      userQuery,
      chatHistory || []
    );

    res.json({
      suggestions,
      transcript: userQuery,
      summary,
      entity,
    });
  } catch (error) {
    console.error("Error in /api/chat:", error);
    if (error.message.includes("503")) {
      return res
        .status(503)
        .json({
          error:
            "The AI service is currently overloaded. Please try again in a moment.",
        });
    }
    if (error instanceof SyntaxError) {
      return res
        .status(500)
        .json({
          error:
            "I had a little trouble understanding that. Could you please rephrase?",
        });
    }
    res.status(500).send("An internal error occurred.");
  }
});

app.post("/api/chat-speech", upload.single("audio"), async (req, res) => {
  let rawTranscript = "";
  try {
    if (!req.file) return res.status(400).send("No audio file uploaded.");
    if (!req.body.metadata)
      return res.status(400).send("Missing metadata field.");

    console.log("\n--- New request on /api/chat-speech ---");
    let metadata;
    try {
      metadata = JSON.parse(req.body.metadata);
    } catch (e) {
      return res.status(400).send("Invalid metadata format.");
    }
    const { chatHistory } = metadata;

    const audioBuffer = req.file.buffer;
    const audioPart = {
      inlineData: {
        data: audioBuffer.toString("base64"),
        mimeType: req.file.mimetype,
      },
    };
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Use flash for fast STT
    const sttResult = await generateWithRetry(model, [
      "Transcribe this real estate query:",
      audioPart,
    ]);

    rawTranscript = sttResult.response.text().trim();
    console.log(`Raw transcribed query: "${rawTranscript}"`);
    const userQuery = rawTranscript.replace(/\[.*?\]|\(.*?\)/g, "").trim();
    console.log(`Cleaned query: "${userQuery}"`);

    if (!userQuery) {
      return res.json({
        suggestions: [],
        transcript: rawTranscript,
        summary: "Sorry, I didn't catch a clear question. Could you try again?",
      });
    }

    const { summary, suggestions, entity } = await runConversation(
      userQuery,
      chatHistory || []
    );
    res.json({ suggestions, transcript: rawTranscript, summary, entity });
  } catch (error) {
    console.error("Error in /api/chat-speech:", error);
    if (error.message.includes("503")) {
      return res
        .status(503)
        .json({
          error:
            "The AI service is currently overloaded. Please try again in a moment.",
        });
    }
    if (error instanceof SyntaxError) {
      return res.status(500).json({
        summary:
          "I had a little trouble understanding that request. Could you please rephrase it?",
        transcript: rawTranscript,
        suggestions: [],
      });
    }
    res.status(500).send("An internal error occurred.");
  }
});

app.post("/api/analyze-properties", async (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res
      .status(400)
      .json({ error: "An array of property IDs is required." });
  }

  try {
    const selectedProperties = allProperties.filter((p) =>
      ids.includes(p.uniqueId)
    );

    if (selectedProperties.length === 0) {
      return res
        .status(404)
        .json({ error: "Could not find any properties for the given IDs." });
    }

    const propertiesForPrompt = selectedProperties.map((item) => ({
      location: item.Property.location,
      type: item.Property.type,
      price: item.Property.priceRange.min,
      totalROI: item.Property.roi.totalROI,
      projectedValue: item.Property.roi.projectedValue,
      marketRisk: item.Property.riskAssessment.marketRisk,
      developerRisk: item.Property.riskAssessment.developerRisk,
      keyFeatures: item.Property.keyFeatures,
    }));

    const analysisPrompt = `
        **Persona:** You are an expert real estate investment analyst providing a concise, professional comparison for a client.
        **Context:** You are analyzing the following properties:
        ---
        ${JSON.stringify(propertiesForPrompt, null, 2)}
        ---
        **Goal:** Perform a comparative analysis and provide a clear recommendation. Follow these steps precisely:
        1.  **Best Overall Investment:** Identify the single best property for a balanced investment based on a combination of the highest Total ROI and the lowest Market Risk. State the location and explain your choice in one or two sentences.
        2.  **Highest Growth Potential:** Identify the single property with the absolute highest 'projectedValue'. State the location and its projected value.
        3.  **Property Summaries:** Provide a brief, one-sentence summary for *each* property, highlighting its main advantage or disadvantage.
        **Format:** Structure your response using Markdown. Use headings (e.g., "### Best Overall Investment"), bullet points, and bold text for property locations and key metrics. Do not include any introductory or concluding pleasantries.
      `;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Using stable model
    const result = await model.generateContent(analysisPrompt);
    const analysisText = result.response.text();

    res.json({ analysis: analysisText });
  } catch (error) {
    console.error("Error in /api/analyze-properties:", error);
    res
      .status(500)
      .json({
        error: "An internal error occurred while generating the analysis.",
      });
  }
});

// --- Server Startup ---
app.listen(PORT, () => {
  console.log(
    `\n✅ Server is fully initialized and listening on port ${PORT}\n`
  );
});
