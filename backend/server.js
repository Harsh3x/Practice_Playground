import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY missing in .env");
  process.exit(1);
}

app.post("/suggest", async (req, res) => {
  try {
    const { problem, code, language, mode } = req.body; 

    // LOG 1: Incoming Request Details
    console.log(`\n--- 📨 NEW REQUEST [Mode: ${mode}] ---`);
    console.log(`🔹 Problem: "${problem.substring(0, 50)}..."`);
    console.log(`🔹 Context Length: ${code ? code.length : 0} chars`);

    const isFullCode = mode === "full";

    const prompt = `
You are a precise "Code Completion Engine".
The user is typing a file in ${language}.
The "INPUT CODE" below contains the file content **EXACTLY UP TO THE CURSOR**.

YOUR JOB:
${isFullCode 
  ? "Generate the REMAINING code from the cursor position to the end of the file." 
  : "Generate ONLY the immediate next logical chunk (4-8 lines)."}

CRITICAL RULES:
1. **NO REPETITION:** Do NOT output any code that is already in "INPUT CODE".
2. **CONTINUITY:** Your output must validly append strictly to the last character of the input.
3. **COMMENTING:** Append a comment "  # " to every line you generate explaining the logic.
4. **FORMAT:** Raw text only. No Markdown blocks.

CONTEXT:
Problem: ${problem}

INPUT CODE (Ends at cursor):
${code || ""}

COMPLETION (Start immediately after the last character above):
`;

    // LOG 2: Sending to API
    console.log("🚀 Sending prompt to Gemini...");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }]
        })
      }
    );

    if (!response.ok) {
        console.error(`❌ API Error: ${response.status} ${response.statusText}`);
        return res.json({ ghost: "" });
    }

    const data = await response.json();
    let ghost = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // LOG 3: Raw Response
    console.log(`✅ Gemini Response received. Length: ${ghost.length} chars`);

    // Clean up markdown just in case the model ignores instructions
    ghost = ghost.replace(/^```[a-z]*\n/i, "").replace(/```$/g, "").trimEnd();

    // LOG 4: Final Output
    console.log(`📤 Sending back ghost text: "${ghost.substring(0, 30).replace(/\n/g, "\\n")}..."`);

    res.json({ ghost });
  } catch (err) {
    console.error("❌ SERVER ERROR:", err);
    res.json({ ghost: "" });
  }
});

app.listen(3000, () => {
  console.log("✅ Gemini backend running on http://localhost:3000");
});