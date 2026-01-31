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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }]
        })
      }
    );

    if (!response.ok) return res.json({ ghost: "" });

    const data = await response.json();
    let ghost = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // Clean up markdown just in case the model ignores instructions
    ghost = ghost.replace(/^```[a-z]*\n/i, "").replace(/```$/g, "").trimEnd();

    res.json({ ghost });
  } catch (err) {
    console.error("❌ Gemini server error:", err);
    res.json({ ghost: "" });
  }
});

app.listen(3000, () => {
  console.log("✅ Gemini backend running on http://localhost:3000");
});
