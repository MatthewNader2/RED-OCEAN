// File: server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs/promises";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// --- Initializations ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const textEmbeddingModel = new GoogleGenerativeAIEmbeddings({
  model: "text-embedding-004",
  apiKey: process.env.GEMINI_API_KEY,
});

// --- CACHING IMPLEMENTATION ---
let vectorStore;
let allProperties = [];

// Immediately invoke the data initialization.
initializeData();

// --- Data Loading and Vector Store Initialization ---
async function initializeData() {
  console.log("Loading, processing, and caching property data...");
  try {
    const jsonData = await fs.readFile("./red ocean.json", "utf-8");
    // FIX: Add uniqueId to each property right after loading
    allProperties = JSON.parse(jsonData).map((p, index) => ({
      ...p,
      uniqueId: index,
    }));

    const documents = allProperties.map((item) => {
      const prop = item.Property;
      const pageContent = `
            Property in ${prop.location} of type ${prop.type}.
            It has ${prop.bedrooms} bedrooms and ${prop.bathrooms} bathrooms.
            The total area is ${prop.totalArea} sq. units.
            Key features include: ${prop.keyFeatures}. Amenities include: ${prop.amenities}.
            The market risk is rated as ${prop.riskAssessment.marketRisk} and the developer risk is ${prop.riskAssessment.developerRisk}.
            The total Return on Investment (ROI) is ${prop.roi.totalROI}%.
        `;
      return {
        pageContent,
        // FIX: Ensure uniqueId is in the vector store metadata
        metadata: { type: "property", ...prop, uniqueId: item.uniqueId },
      };
    });

    console.log("Creating vector store in memory...");
    vectorStore = await MemoryVectorStore.fromDocuments(
      documents,
      textEmbeddingModel
    );
    console.log("✅ Data has been successfully cached.");
  } catch (error) {
    console.error("----------- FAILED TO INITIALIZE DATA -----------", error);
    process.exit(1);
  }
}

app.use(cors());
app.use(express.json());

// --- Endpoint to get all property data ---
app.get("/api/properties", (req, res) => {
  if (allProperties.length > 0) {
    res.json(allProperties);
  } else {
    res
      .status(503)
      .json({
        error:
          "Property data is not yet available. Please try again in a moment.",
      });
  }
});

// --- Main Chat Endpoint ---
app.post("/api/chat", async (req, res) => {
  try {
    const { userQuery } = req.body;
    if (!userQuery) {
      return res.status(400).json({ error: "userQuery is required" });
    }

    console.log(`Received query: ${userQuery}`);

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

    // --- 1. Intent Recognition ---
    const intentPrompt = `
      You are a highly intelligent real estate AI assistant. Your primary function is to analyze a user's query and categorize it into a specific intent, extracting all relevant parameters.

      **INTENT CATEGORIES & PARAMETERS:**

      **1. Search & Filter Intents (Finding Properties):**
      - **PRICE_RANGE_SEARCH**: User mentions a price or budget (e.g., "under 1M", "between 2M and 3M").
      - **ROOM_RANGE_SEARCH**: User specifies a number of rooms (e.g., "3 bedrooms", "at least 2 rooms").
      - **AREA_RANGE_SEARCH**: User specifies a size or area (e.g., "bigger than 1500 sq ft").
      - **DELIVERY_DATE_SEARCH**: User asks about completion or delivery dates (e.g., "ready to move", "delivering in 2025").
      - **TYPE_SEARCH**: User specifies a property type (e.g., "show me commercial properties", "any villas?").
      - **MULTI_FILTER_SEARCH**: A combination of two or more of the above filters.
      - **SEMANTIC_STYLE_SEARCH**: User uses subjective terms or asks about amenities (e.g., "something modern", "with a sea view", "does it have a pool?").

      **2. Comparative & Ranking Intents ("Best Of"):**
      - **CHEAPEST**: User asks for the lowest price properties.
      - **MOST_EXPENSIVE**: User asks for the highest price properties.
      - **MOST_ROOMS**: User asks for properties with the most bedrooms.
      - **LARGEST_AREA**: User asks for the properties with the biggest area.
      - **BEST_INVESTMENT**: User asks for the best investment or highest ROI.
      - **HIGHEST_PROJECTED_VALUE**: User asks about future value or growth.
      - **BEST_PRICE_PER_AREA**: User asks for the best value or most space for the money.
      - **LOWEST_RISK**: User asks for the safest or lowest risk options.

      **3. Specific Detail Intents (Follow-up Questions):**
      - **SPECIFIC_PROPERTY_INQUIRY**: User asks a general question about a specific property they mention by name/location (e.g., "tell me more about the one in Suite 57").
      - **PAYMENT_PLAN_INQUIRY**: User asks about the payment plan for a specific property.
      - **ROI_DETAILS_INQUIRY**: User asks for specific ROI details (annual, total, etc.) for a property.

      **4. Conversational Intents (The Chat):**
      - **GREETING**: A simple greeting like "hello" or "hi".
      - **FAREWELL**: A sign-off like "thanks" or "bye".
      - **HELP_INQUIRY**: User asks about your capabilities (e.g., "what can you do?").
      - **CONTACT_AGENT**: User wants to speak to a human.
      - **OUT_OF_SCOPE**: The query is unrelated to real estate.

      **PARAMETER EXTRACTION:**
      - Extract any of the following values if mentioned: minPrice, maxPrice, minRooms, maxRooms, minArea, maxArea, type, deliveryYear, propertyName.

      **RESPONSE FORMAT (JSON ONLY):**
      {
        "intent": "YOUR_CHOSEN_INTENT",
        "parameters": { "...all extracted parameters..." },
        "responseToUser": "A direct, conversational response ONLY for Conversational Intents."
      }

      **User Query: "${userQuery}"**
    `;
    const intentResult = await model.generateContent(intentPrompt);
    const cleanedResponse = intentResult.response
      .text()
      .trim()
      .replace(/```json/g, "")
      .replace(/```/g, "");
    const structuredQuery = JSON.parse(cleanedResponse);
    console.log("Structured Query:", structuredQuery);

    const { intent, parameters, responseToUser } = structuredQuery;
    let suggestionsForUI = [];
    let summaryTextToSpeak = "";

    // --- 2. Fulfilling the Intent ---
    if (responseToUser) {
      summaryTextToSpeak = responseToUser;
    } else {
      // A. Handle simple, direct filter/sort intents
      if (intent === "CHEAPEST") {
        suggestionsForUI = [...allProperties]
          .sort(
            (a, b) =>
              (a.Property.priceRange.min || Infinity) -
              (b.Property.priceRange.min || Infinity)
          )
          .slice(0, 3);
      } else if (intent === "MOST_EXPENSIVE") {
        suggestionsForUI = [...allProperties]
          .sort(
            (a, b) =>
              (b.Property.priceRange.min || 0) -
              (a.Property.priceRange.min || 0)
          )
          .slice(0, 3);
      } else if (intent === "MOST_ROOMS") {
        suggestionsForUI = [...allProperties]
          .sort(
            (a, b) => (b.Property.bedrooms || 0) - (a.Property.bedrooms || 0)
          )
          .slice(0, 3);
      } else if (intent === "LARGEST_AREA") {
        suggestionsForUI = [...allProperties]
          .sort(
            (a, b) => (b.Property.totalArea || 0) - (a.Property.totalArea || 0)
          )
          .slice(0, 3);
      } else if (intent === "BEST_INVESTMENT") {
        suggestionsForUI = [...allProperties]
          .sort(
            (a, b) =>
              (b.Property.roi.totalROI || 0) - (a.Property.roi.totalROI || 0)
          )
          .slice(0, 3);
      } else if (intent === "HIGHEST_PROJECTED_VALUE") {
        suggestionsForUI = [...allProperties]
          .sort(
            (a, b) =>
              (b.Property.roi.projectedValue || 0) -
              (a.Property.roi.projectedValue || 0)
          )
          .slice(0, 3);
      } else if (intent === "BEST_PRICE_PER_AREA") {
        suggestionsForUI = [...allProperties]
          .filter(
            (p) => p.Property.priceRange.min > 0 && p.Property.totalArea > 0
          )
          .sort(
            (a, b) =>
              a.Property.priceRange.min / a.Property.totalArea -
              b.Property.priceRange.min / b.Property.totalArea
          )
          .slice(0, 3);
      } else if (intent === "LOWEST_RISK") {
        const getRiskScore = (prop) => {
          let score = 0;
          if (prop.riskAssessment.marketRisk === "Low") score += 1;
          if (prop.riskAssessment.marketRisk === "Medium") score += 2;
          if (prop.riskAssessment.marketRisk === "High") score += 3;
          if (prop.riskAssessment.developerRisk === "Low") score += 1;
          if (prop.riskAssessment.developerRisk === "Medium") score += 2;
          if (prop.riskAssessment.developerRisk === "High") score += 3;
          return score;
        };
        suggestionsForUI = [...allProperties]
          .sort((a, b) => getRiskScore(a.Property) - getRiskScore(b.Property))
          .slice(0, 3);
      }
      // B. Handle specific detail intents
      else if (
        intent.includes("SPECIFIC_PROPERTY") ||
        intent.includes("PAYMENT_PLAN") ||
        intent.includes("ROI_DETAILS")
      ) {
        const propertyName = parameters.propertyName || "";
        const foundProp = allProperties.find((p) =>
          p.Property.location.toLowerCase().includes(propertyName.toLowerCase())
        );

        if (foundProp) {
          const prop = foundProp.Property;
          if (intent === "PAYMENT_PLAN_INQUIRY") {
            summaryTextToSpeak = `The payment plan for the property in ${
              prop.location
            } is: ${prop.paymentPlan || "Details not available."}`;
          } else if (intent === "ROI_DETAILS_INQUIRY") {
            summaryTextToSpeak = `For the property in ${
              prop.location
            }, the Total ROI is ${prop.roi.totalROI}%, Annual ROI is ${
              prop.roi.annualROI
            }%, and the projected value is $${prop.roi.projectedValue.toLocaleString()}.`;
          } else {
            // General inquiry
            summaryTextToSpeak = `Here are more details for the property in ${prop.location}: It's a ${prop.type} unit with ${prop.bedrooms} bedrooms, a total area of ${prop.totalArea}, and a market risk rated as '${prop.riskAssessment.marketRisk}'.`;
          }
        } else {
          summaryTextToSpeak =
            "I'm sorry, I couldn't find a specific property matching that name. Could you be more specific?";
        }
      }
      // C. Handle complex search intents that use the vector store
      else {
        const filterFn = (doc) => {
          const meta = doc.metadata;
          if (
            parameters.minPrice &&
            (meta.priceRange.min || 0) < parameters.minPrice
          )
            return false;
          if (
            parameters.maxPrice &&
            (meta.priceRange.min || Infinity) > parameters.maxPrice
          )
            return false;
          if (parameters.minRooms && (meta.bedrooms || 0) < parameters.minRooms)
            return false;
          if (
            parameters.maxRooms &&
            (meta.bedrooms || Infinity) > parameters.maxRooms
          )
            return false;
          if (parameters.minArea && (meta.totalArea || 0) < parameters.minArea)
            return false;
          if (
            parameters.maxArea &&
            (meta.totalArea || Infinity) > parameters.maxArea
          )
            return false;
          if (
            parameters.type &&
            !new RegExp(parameters.type, "i").test(meta.type)
          )
            return false;
          if (
            parameters.deliveryYear &&
            !meta.delivery.includes(String(parameters.deliveryYear))
          )
            return false;
          return true;
        };

        const searchResults = await vectorStore.similaritySearch(
          userQuery,
          3,
          filterFn
        );
        suggestionsForUI = searchResults.map((result) => ({
          Property: result.metadata,
          uniqueId: result.metadata.uniqueId, // Pass the ID to the frontend
        }));
      }

      // --- 3. Generate Final Summary ---
      if (suggestionsForUI.length > 0 && !summaryTextToSpeak) {
        const thinkingPrompt = `
          You are an expert real estate AI. Based on the user's query ("${userQuery}") and the best matching property below, generate a single, concise sentence.
          **RULES:**
          1. BE BRIEF: Under 20 words.
          2. BE PERSUASIVE: Briefly mention the key reason it's a good match.
          3. GET TO THE POINT: No "I found..." or "Based on your query...".
          **BEST MATCH DATA:**
          ---
          ${JSON.stringify(suggestionsForUI[0])}
          ---
        `;
        const thinkingResult = await model.generateContent(thinkingPrompt);
        summaryTextToSpeak = thinkingResult.response.text().trim();
      } else if (!summaryTextToSpeak) {
        summaryTextToSpeak =
          "I couldn't find any properties that matched your criteria.";
      }
    }

    res.json({
      suggestions: suggestionsForUI,
      transcript: userQuery,
      summary: summaryTextToSpeak,
    });
  } catch (error) {
    console.error("Error in /api/chat:", error);
    res.status(500).send("An internal error occurred.");
  }
});

// --- AI Investment Analysis Endpoint ---
app.post("/api/analyze-properties", async (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res
      .status(400)
      .json({ error: "An array of property IDs is required." });
  }

  console.log(`Received analysis request for ${ids.length} properties.`);

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

      **Context:** You are analyzing the following ${
        propertiesForPrompt.length
      } properties:
      ---
      ${JSON.stringify(propertiesForPrompt, null, 2)}
      ---

      **Goal:** Your task is to perform a comparative analysis and provide a clear recommendation. Follow these steps precisely:
      1.  **Best Overall Investment:** Identify the single best property for a balanced investment. Your reasoning *must* be based on a combination of the highest Total ROI and the lowest Market Risk. State the location and explain your choice in one or two sentences.
      2.  **Highest Growth Potential:** Identify the single property with the absolute highest 'projectedValue'. State the location and its projected value.
      3.  **Property Summaries:** Provide a brief, one-sentence summary for *each* property, highlighting its main advantage or disadvantage (e.g., "Suite 57 offers the best ROI but comes with high market risk.").

      **Format:** Structure your response using Markdown. Use headings (e.g., "### Best Overall Investment"), bullet points for the summaries, and bold text for property locations and key metrics. Do not include any introductory or concluding pleasantries.
    `;

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
    const result = await model.generateContent(analysisPrompt);
    const analysisText = result.response.text();

    console.log("Successfully generated AI analysis.");

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