require("dotenv").config();

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("AI request timeout")), ms)
    )
  ]);

function basicAuth(req, res, next) {
  const user = process.env.BASIC_USER;
  const pass = process.env.BASIC_PASS;

  if (!user || !pass) return next();

  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  if (type !== "Basic" || !token) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Protected"');
    return res.status(401).send("Auth required");
  }

  const decoded = Buffer.from(token, "base64").toString("utf8");
  const [u, p] = decoded.split(":");

  if (u === user && p === pass) return next();

  res.setHeader("WWW-Authenticate", 'Basic realm="Protected"');
  return res.status(401).send("Invalid credentials");
}

app.use(cors());
app.use(express.static(__dirname));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/analyze", basicAuth, upload.single("file"), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY 尚未設定" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "請上傳圖片檔" });
    }

    const base64 = req.file.buffer.toString("base64");
    const mime = req.file.mimetype;

    const prompt = `
你是台灣的健康管理助理。使用者上傳一張 INBODY 或身體組成分析表影像。
請先從影像抽取你看得到的數值到 extracted_metrics（看不到不要猜）。

接著用一般民眾看得懂的語氣，提供重點分析和建議：
- 說明目前身體狀態
- 提供有氧與肌力訓練建議
- 提供飲食控制重點
- 內容務必具體可執行

請只輸出 JSON，格式必須完全符合：
{
  "extracted_metrics": {
    "weight_kg": number|null,
    "pbf_percent": number|null,
    "skeletal_muscle_mass_kg": number|null,
    "bmi": number|null,
    "bmr_kcal": number|null,
    "visceral_fat_level": number|null
  },
  "summary": "string",
  "analysis": ["string", "string", "string"],
  "exercise_plan": {
    "aerobic": "string",
    "strength": "string",
    "weekly_goal": "string"
  },
  "diet_plan": {
    "calorie_strategy": "string",
    "protein_strategy": "string",
    "avoid": "string"
  },
  "follow_up": "string",
  "disclaimer": "本建議為一般健康管理參考，非醫療診斷。"
}
`;

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await withTimeout(
      client.responses.create({
        model: "gpt-5",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_url: `data:${mime};base64,${base64}` }
            ]
          }
        ]
      }),
      55000
    );

    const text = response.output_text;

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "AI 回傳不是合法 JSON",
        raw: text
      });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
