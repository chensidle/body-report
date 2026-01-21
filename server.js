require("dotenv").config();

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

const withTimeout = (p, ms) =>
  Promise.race([
    p,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("AI request timeout")), ms)
    )
  ]);

function basicAuth(req, res, next) {
  const user = process.env.BASIC_USER;
  const pass = process.env.BASIC_PASS;
  if (!user || !pass) return next(); // 沒設定就不啟用（部署時建議一定要設）

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

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });
app.post("/api/analyze", basicAuth, upload.single("file"), async (req, res) => {
});

app.use(basicAuth); 
app.use(cors());
app.use(express.static(__dirname));



const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get("/", (req, res) => {
  res.send("Server OK");
});

app.post("/api/analyze", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // 圖片轉 base64
    const base64 = req.file.buffer.toString("base64");
    const mime = req.file.mimetype;

const prompt = `
你是台灣的健康管理助理。使用者上傳一張「身體組成分析表」影像。
請先從影像抽取你看得到的數值到 extracted_metrics（看不到不要猜）。

接著請你用「身體組成【減重專用簡易模板 v2】」產出給一般民眾看的建議：
- 語氣專業、白話、可執行
- 報告內容不要出現數字或百分比（數字只能放在 extracted_metrics 裡）
- 「一句話總結」必須同時包含這三個詞：體重、體脂、肌肉量
- 不要新增段落或欄位

請只輸出 JSON，格式必須完全符合：

{
  "extracted_metrics": {
    "weight_kg": number|null,
    "pbf_percent": number|null,
    "skeletal_muscle_mass_kg": number|null
  },
  "one_line_summary": "string",
  "status_points": {
    "weight_status": "良好|尚可|需改善",
    "bodyfat_status": "良好|尚可|需改善",
    "muscle_status": "良好|尚可|需改善"
  },
  "top3_actions": ["string","string","string"],
  "exercise": {
    "frequency_per_week": "string",
    "type": "string",
    "note": "string"
  },
  "diet": {
    "meal_focus": "string",
    "meal_rule": "string",
    "avoid": "string"
  },
  "success_signs": ["string","string"],
  "follow_up": "string",
  "disclaimer": "本建議為一般健康管理參考，非醫療診斷。"
}
`;


    const r = await withTimeout(
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


    // 取得模型輸出文字（應該是一段 JSON 字串）
    const text = r.output_text;

    // 嘗試 parse JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "AI 回傳不是 JSON（先把原文回傳方便除錯）",
        raw: text
      });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

