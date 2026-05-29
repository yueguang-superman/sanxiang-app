import { byId, catalogFor } from "./catalog.js";

const stripFence = (text) =>
  String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

const parseJson = (text) => {
  const cleaned = stripFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI 返回不是 JSON。");
    return JSON.parse(match[0]);
  }
};

const fallbackBox = (index) => ({
  x: 12 + (index % 3) * 24,
  y: 16 + Math.floor(index / 3) * 18,
  width: 18,
  height: 12,
});

export const analyzeImage = async ({ kind, imageDataUrl, imageMeta, env }) => {
  if (!env.AI_API_KEY) {
    throw new Error("尚未配置通义千问 API Key。请在 Cloudflare 环境变量中设置 AI_API_KEY。");
  }

  if (!String(imageDataUrl || "").startsWith("data:image/")) {
    throw new Error("图片格式无效。");
  }

  const catalog = catalogFor(kind);
  const names = catalog.map((item) => `${item.id}:${item.name}`).join("；");
  const title = kind === "palm" ? "手相" : "面相";
  const prompt =
    `你是传统术数图像标注助手。请识别这张${title}图片中的特殊点。` +
    `必须只返回 JSON，不要解释。可选特征库：${names}。` +
    `返回格式：{"features":[{"featureId":"life_line","name":"地纹","category":"主纹","box":{"x":10,"y":20,"width":30,"height":10},"confidence":0.82,"evidence":"可见线条深长","needsReview":false}],"imageQuality":"clear|blurry|partial","notes":["..."]}。` +
    `box 坐标使用百分比 0-100。只标有视觉依据的内容；不确定则 confidence 低于 0.55 且 needsReview=true。`;

  const baseUrl = env.AI_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const model = env.AI_MODEL || "qwen3.6-flash";
  const endpoint = baseUrl.replace(/\/$/, "") + "/chat/completions";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.AI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`视觉 AI 调用失败：${response.status} ${text.slice(0, 120)}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  const parsed = parseJson(content);
  const catalogMap = byId(kind);
  const features = Array.isArray(parsed.features) ? parsed.features : [];

  return {
    kind,
    imageMeta,
    imageQuality: parsed.imageQuality || "unknown",
    notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 4) : [],
    features: features.slice(0, 18).map((feature, index) => {
      const known = catalogMap.get(feature.featureId) || catalog[index % catalog.length];
      const confidence = Number(feature.confidence ?? 0.5);
      return {
        featureId: known.id,
        name: feature.name || known.name,
        category: feature.category || known.category,
        box: feature.box || fallbackBox(index),
        confidence: Math.max(0, Math.min(1, confidence)),
        evidence: String(feature.evidence || ""),
        needsReview: Boolean(feature.needsReview || confidence < 0.58),
        interpretation: known.interpretation,
        sourceTitle: known.sourceTitle,
      };
    }),
  };
};
