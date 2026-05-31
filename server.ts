import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Need larger limit for base64 image uploads
app.use(express.json({ limit: "50mb" }));

app.post("/api/generate", async (req, res) => {
  try {
    const { image, mimeType, language = 'en', isVariation = false, detailLevel = 'ultra', aspectRatio = '1:1', controls } = req.body;
    
    // Default controls fallback
    const userControls = controls || { face: 100, pose: 100, outfit: 85, lighting: 90 };

    if (!image || !mimeType) {
      return res.status(400).json({ error: "Image and mimeType are required" });
    }
    
    // Remove data URL prefix if present
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const langInstruction = language === 'id' ? "Indonesian (Bahasa Indonesia)" : "English";

    const variationInstruction = isVariation ? "THIS IS A VARIATION REQUEST: Keep the exact same person, face, pose, and outfit details, but creatively alter the environment, lighting, camera angle, and artistic photo style (e.g., change from day to night, from street candid to studio lighting, or from film to disposable camera) for a new interpretation." : "";

    let detailInstruction = "Be EXHAUSTIVELY detailed. Describe every layer of clothing, exact material physics, micro-expressions, precise camera lens physics (e.g., focal length, aperture), deep atmospheric elements, and microscopic lighting nuances.";
    if (detailLevel === "basic") {
      detailInstruction = "Keep the prompt concise and straightforward. Focus only on the most essential identifying features and overall mood. Avoid overly wordy descriptions.";
    } else if (detailLevel === "detailed") {
      detailInstruction = "Provide a well-detailed prompt. Include specific textures, lighting setups, and noticeable environmental elements.";
    }

    const promptText = `
Analyze the provided image and generate components for an image generation prompt.
Identify the facial identity, hairstyle, outfit (be EXHAUSTIVELY detailed: textures, colors, fit, layers, condition, specific garments, accessories, wrinkles), pose/posture, lighting, environment, camera composition including EXACT SUBJECT FRAMING/SHOT TYPE (e.g., extreme close-up, close-up, medium shot, cowboy shot, full body, wide shot), deeply analyze camera POV (e.g., selfie vs candid vs shot by another person, distance, angle), and the specific photo quality/texture.

${variationInstruction}

User explicitly set these precision controls:
- Face Consistency Lock: ${userControls.face}%
- Pose Consistency Lock: ${userControls.pose}%
- Outfit Preservation Lock: ${userControls.outfit}%
- Lighting & Quality Match Lock: ${userControls.lighting}%

You must output a JSON response matching the following schema.

Requirements:
1. mainPrompt: Create a hyper-realistic, highly detailed prompt describing the scene. Start with: "[LOCK: exact subject framing - e.g. full body shot, medium shot], [LOCK: identical camera POV - e.g. selfie, shot by another person at eye level, low angle], [LOCK: identical face to reference image, ${userControls.face}% identical facial structure, IDENTICAL MICRO-EXPRESSION AND EMOTION], [LOCK: identical hairstyle to reference image], [LOCK: ${userControls.outfit}% identical outfit preservation, EXHAUSTIVELY DETAILED: describe every layer], [LOCK: ${userControls.pose}% identical pose and body language to reference image, RIGIDLY describe head angle, limb positions, and body posture]". 
CRITICAL SKIN REALISM: Maintain natural, realistic human skin texture. Visible pores, subtle unevenness, natural shadows, slight skin imperfections, and organic tonal variation must be present. Avoid plastic-like smoothing, excessive airbrushing, waxy surfaces, or artificial glow. Preserve his original skin tone accurately — not overly brightened or whitened. Keep natural warmth and depth in complexion with balanced exposure. No beauty filter effect. No over-softening. No porcelain skin rendering.
CRITICAL: Explicitly analyze and describe the EXACT camera POV (e.g., "shot by another person at eye level", "selfie from high angle") and the EXACT TRUE photo quality. DO NOT blindly add "film grain", "retro", or "noise" unless it is visibly present in the image. If the image is a clean, sharp, modern smartphone photo (like iPhone) or DSLR, explicitly state it is a "clean, sharp modern digital photo without noise or film grain". The output MUST aim for ultra-realistic native photography matching the exact source quality. It MUST NOT look plastic, CGI, or "AI-generated".
COMPLEXITY LEVEL: ${detailInstruction}
IMPORTANT: The descriptive part of the prompt MUST be written in ${langInstruction}. The [LOCK] tags should remain in English but the rest of the description must be in ${langInstruction}.
2. negativePrompt: Generate a negative prompt: "plastic, CGI, AI generated, airbrushed, overly smooth, artificial, 3d render, selfie (if it's NOT a selfie), ugly, deformed, disfigured, bad anatomy, bad lighting, text, watermark". (Translate this to ${langInstruction} if applicable).
3. freyParameters: Create an array of strings representing key parameters (e.g. "FRAMINGLOCK: EXACTLY AS REFERENCE", "FACELOCK: ${userControls.face}%", "EXPRESSIONLOCK: 100%", "RAMBUTLOCK: 100%", "OUTFITLOCK: ${userControls.outfit}%", "POSELOCK: ${userControls.pose}%", "POV:...", "QUALITY:...", "ANGLE:...", "LIGHTING:...", "MOOD:...", "FOCUS:..."). Key-value format only. Values should be in ${langInstruction} where appropriate. Append "--ar ${aspectRatio}" as one of the parameters.
4. combinedPrompt: Create a unified, single ready-to-use text block combining the main prompt, negative prompt, and parameters. Format cleanly. Use ${langInstruction} for connecting text. Ensure it ends with "--ar ${aspectRatio}".
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: {
        parts: [
          { text: promptText },
          { inlineData: { mimeType, data: base64Data } }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mainPrompt: {
              type: Type.STRING,
              description: "The main generated prompt starting with the locking tags.",
            },
            negativePrompt: {
              type: Type.STRING,
              description: "The negative prompt for image generation.",
            },
            freyParameters: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "List of key parameters like FACELOCK, RAMBUTLOCK, OUTFITLOCK, POSELOCK, QUALITY, ANGLE, LIGHTING",
            },
            combinedPrompt: {
              type: Type.STRING,
              description: "The complete, ready-to-use prompt combining main, negative, and parameters.",
            },
          },
        },
      },
    });

    const result = JSON.parse(response.text || "{}");
    if (!result.mainPrompt) {
      throw new Error("Failed to generate prompt properly.");
    }

    res.json(result);
  } catch (error: any) {
    console.error("API error:", error);
    res.status(500).json({ error: error.message || "Failed to analyze image" });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
