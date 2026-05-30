import { byId, catalogFor } from "./catalog.js";

const stripFence = (text) =>
  String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

const contentText = (content) => {
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("\n");
  }
  return String(content || "");
};

const parseJson = (text) => {
  const cleaned = stripFence(contentText(text));
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("测算结果格式异常，请重试。");
    return JSON.parse(match[0]);
  }
};

const parseAnalysis = (content) => {
  try {
    return parseJson(content);
  } catch {
    return {
      usable: true,
      imageQuality: "unknown",
      reportText: contentText(content).trim(),
      features: [],
    };
  }
};

const explainAiError = (status, text, model) => {
  const raw = String(text || "");
  if ([408, 504, 524].includes(status)) {
    return "看图超时了。请换一张更近、更亮、背景更少的照片后重试。";
  }
  if (status === 400 && /InvalidParameter|messages|image|video|vision/i.test(raw)) {
    return "这张照片暂时看不了。请重新上传一张更清楚、背景更少的照片。";
  }
  if (status === 401 || status === 403) {
    return "测算服务暂时不可用，请联系管理员检查配置。";
  }
  if (status === 429) {
    return "今天请求太频繁了，请稍后再试。";
  }
  return `看图失败，服务返回 ${status}。请稍后重试。`;
};

const fetchWithTimeout = async (url, options, timeoutMs, timeoutMessage) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const timeoutMs = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 5000 ? parsed : fallback;
};

const aiEndpoint = (env) => (env.AI_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "") + "/chat/completions";

const aiJsonMode = (env) => env.AI_JSON_MODE === "on";

const callAiChat = async ({ env, model, messages, maxTokens = 300, temperature = 0, timeout = 30000, responseFormat = true, timeoutMessage }) => {
  if (!env.AI_API_KEY) {
    throw new Error("测算服务还没配置好，请联系管理员。");
  }

  const requestBody = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages,
  };

  if (responseFormat && aiJsonMode(env)) {
    requestBody.response_format = { type: "json_object" };
  }

  const response = await fetchWithTimeout(
    aiEndpoint(env),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.AI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    timeout,
    timeoutMessage || "测算请求超时，请稍后重试。"
  );

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(explainAiError(response.status, text, model));
    error.status = response.status;
    error.raw = text.slice(0, 600);
    throw error;
  }

  const payload = await response.json();
  return {
    payload,
    content: payload.choices?.[0]?.message?.content,
  };
};

const fallbackBox = (index) => ({
  x: 12 + (index % 3) * 24,
  y: 16 + Math.floor(index / 3) * 18,
  width: 18,
  height: 12,
});

const compactName = (name) => String(name || "").replace(/[（）()]/g, "").replace(/\s/g, "");

const matchCatalogItem = (catalog, catalogMap, feature, index) => {
  const byId = catalogMap.get(feature.featureId);
  if (byId) return byId;

  const featureName = compactName(feature.name);
  const byName = catalog.find((item) => {
    const itemName = compactName(item.name);
    const itemBase = compactName(item.name.split("（")[0]);
    return featureName && (featureName.includes(itemBase) || itemName.includes(featureName));
  });
  return byName || null;
};

const normalizeBox = (box) => {
  if (!box) return null;
  const rawX = Number(box.x ?? box.left);
  const rawY = Number(box.y ?? box.top);
  const rawWidth = Number(box.width ?? box.w);
  const rawHeight = Number(box.height ?? box.h);
  if (![rawX, rawY, rawWidth, rawHeight].every(Number.isFinite)) return null;
  const x = Math.max(0, Math.min(98, rawX));
  const y = Math.max(0, Math.min(98, rawY));
  return {
    x,
    y,
    width: Math.max(2, Math.min(100 - x, rawWidth)),
    height: Math.max(2, Math.min(100 - y, rawHeight)),
  };
};

const normalizePoints = (points) => {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => ({
      x: Math.max(0, Math.min(100, Number(point?.x ?? point?.[0] ?? 0))),
      y: Math.max(0, Math.min(100, Number(point?.y ?? point?.[1] ?? 0))),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .slice(0, 16);
};

const normalizeSegments = (segments, points) => {
  const rawSegments = Array.isArray(segments) && segments.length ? segments : [points || []];
  return rawSegments
    .map(normalizePoints)
    .filter((segment) => segment.length >= 2)
    .slice(0, 6);
};

const palmMainLineIds = new Set(["life_line", "head_line", "heart_line", "fate_line", "marriage_line"]);
const palmPriority = ["life_line", "head_line", "heart_line", "fate_line", "marriage_line", "palm_shape", "five_fingers"];
const featurePriority = new Map([...palmPriority, ...["yintang", "brows", "eyes", "nose_root", "nose_tip", "philtrum", "mouth", "law_lines", "ears", "chin", "forehead", "moles_scars_qi"]].map((id, index) => [id, index]));

const fallbackSubjectBox = (kind) => (kind === "palm" ? { x: 4, y: 20, width: 92, height: 78 } : { x: 10, y: 4, width: 80, height: 92 });

const subjectBoxFrom = (kind, parsed = {}) =>
  normalizeBox(parsed.subjectBox || parsed.palmBox || parsed.handBox || parsed.faceBox || parsed.regionBox || parsed.region);

const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const pointInBox = (point, box, padding = 0) =>
  point.x >= box.x - padding &&
  point.x <= box.x + box.width + padding &&
  point.y >= box.y - padding &&
  point.y <= box.y + box.height + padding;

const boxCenter = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

const boxInsideRegion = (box, region, padding = 2) => pointInBox(boxCenter(box), region, padding);

const pointsBounds = (points) => {
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(2, Math.max(...xs) - x),
    height: Math.max(2, Math.max(...ys) - y),
  };
};

const segmentsBounds = (segments) => pointsBounds(segments.flat());

const traceScore = (points) => {
  if (points.length < 2) return { length: 0, maxSegment: 0 };
  const distances = points.slice(1).map((point, index) => pointDistance(points[index], point));
  return {
    length: distances.reduce((sum, value) => sum + value, 0),
    maxSegment: Math.max(...distances),
  };
};

const allSegmentsInside = (segments, region) => segments.every((segment) => segment.every((point) => pointInBox(point, region, 2)));

const palmCoreBox = (subjectBox) => ({
  x: subjectBox.x + subjectBox.width * 0.04,
  y: subjectBox.y + subjectBox.height * 0.32,
  width: subjectBox.width * 0.92,
  height: subjectBox.height * 0.62,
});

const segmentDirection = (points) => {
  const first = points[0] || { x: 0, y: 0 };
  const last = points[points.length - 1] || first;
  return { dx: last.x - first.x, dy: last.y - first.y };
};

const validPalmLine = (featureId, segments, subjectBox) => {
  const points = segments.flat();
  const bounds = pointsBounds(points);
  if (!bounds) return false;

  const requiredPoints = {
    life_line: 5,
    head_line: 5,
    heart_line: 5,
    fate_line: 3,
    marriage_line: 2,
  }[featureId] || 4;
  const maxSegment = {
    life_line: 18,
    head_line: 18,
    heart_line: 18,
    fate_line: 22,
    marriage_line: 12,
  }[featureId] || 18;
  const score = traceScore(points);
  if (points.length < requiredPoints || score.length < 4 || score.maxSegment > maxSegment) return false;

  const core = palmCoreBox(subjectBox);
  if (featureId !== "marriage_line" && !allSegmentsInside(segments, core)) return false;

  const center = boxCenter(bounds);
  const direction = segmentDirection(points);
  if (featureId === "life_line") {
    return bounds.height >= 26 && bounds.width >= 6 && bounds.width <= 42 && bounds.height / bounds.width >= 1.15 && center.y >= core.y + core.height * 0.38;
  }
  if (featureId === "head_line") {
    return bounds.width >= 24 && bounds.width <= 66 && bounds.height <= 34 && Math.abs(direction.dx) >= 16 && center.y >= core.y + core.height * 0.08 && center.y <= core.y + core.height * 0.68;
  }
  if (featureId === "heart_line") {
    return bounds.width >= 22 && bounds.width <= 68 && bounds.height <= 24 && Math.abs(direction.dx) >= 16 && center.y >= core.y && center.y <= core.y + core.height * 0.34;
  }
  if (featureId === "fate_line") {
    return bounds.height >= 20 && bounds.width <= 18 && Math.abs(direction.dy) >= 16 && center.x >= core.x + core.width * 0.34 && center.x <= core.x + core.width * 0.66;
  }
  if (featureId === "marriage_line") {
    return bounds.width >= 4 && bounds.width <= 18 && bounds.height <= 7 && center.y >= subjectBox.y + subjectBox.height * 0.18 && center.y <= subjectBox.y + subjectBox.height * 0.48 && (center.x <= subjectBox.x + subjectBox.width * 0.36 || center.x >= subjectBox.x + subjectBox.width * 0.64);
  }
  return true;
};

const faceBoxLimits = {
  forehead: { width: 70, height: 22 },
  yintang: { width: 18, height: 14 },
  brows: { width: 62, height: 14 },
  eyes: { width: 62, height: 18 },
  nose_root: { width: 18, height: 20 },
  nose_tip: { width: 28, height: 24 },
  philtrum: { width: 18, height: 18 },
  mouth: { width: 38, height: 16 },
  law_lines: { width: 46, height: 28 },
  ears: { width: 28, height: 38 },
  chin: { width: 42, height: 20 },
  moles_scars_qi: { width: 24, height: 20 },
};

const relativeBox = (box, region) => ({
  x: (box.x - region.x) / region.width,
  y: (box.y - region.y) / region.height,
  width: box.width / region.width,
  height: box.height / region.height,
  centerX: (box.x + box.width / 2 - region.x) / region.width,
  centerY: (box.y + box.height / 2 - region.y) / region.height,
});

const between = (value, min, max) => value >= min && value <= max;

const validFaceBox = (featureId, box, subjectBox) => {
  const rel = relativeBox(box, subjectBox);
  const compact = rel.width <= 0.82 && rel.height <= 0.45;
  if (!compact) return false;

  if (featureId === "forehead") return between(rel.centerY, 0.04, 0.28) && rel.height <= 0.24;
  if (featureId === "yintang") return between(rel.centerX, 0.38, 0.62) && between(rel.centerY, 0.18, 0.38) && rel.width <= 0.24 && rel.height <= 0.2;
  if (featureId === "brows") return between(rel.centerY, 0.2, 0.4) && rel.height <= 0.18;
  if (featureId === "eyes") return between(rel.centerY, 0.28, 0.5) && rel.height <= 0.22;
  if (featureId === "nose_root") return between(rel.centerX, 0.38, 0.62) && between(rel.centerY, 0.32, 0.52) && rel.width <= 0.26 && rel.height <= 0.26;
  if (featureId === "nose_tip") return between(rel.centerX, 0.34, 0.66) && between(rel.centerY, 0.44, 0.66) && rel.width <= 0.34 && rel.height <= 0.3;
  if (featureId === "philtrum") return between(rel.centerX, 0.38, 0.62) && between(rel.centerY, 0.56, 0.74) && rel.width <= 0.24 && rel.height <= 0.2;
  if (featureId === "mouth") return between(rel.centerX, 0.3, 0.7) && between(rel.centerY, 0.62, 0.8) && rel.width <= 0.5 && rel.height <= 0.2;
  if (featureId === "law_lines") return between(rel.centerX, 0.22, 0.78) && between(rel.centerY, 0.48, 0.74) && rel.height <= 0.36;
  if (featureId === "ears") return (rel.centerX <= 0.16 || rel.centerX >= 0.84) && between(rel.centerY, 0.28, 0.68) && rel.height <= 0.5;
  if (featureId === "chin") return between(rel.centerX, 0.28, 0.72) && between(rel.centerY, 0.74, 0.96) && rel.height <= 0.24;
  if (featureId === "moles_scars_qi") return rel.width <= 0.32 && rel.height <= 0.28;
  return true;
};

const retakeAdvice = (kind) =>
  kind === "palm"
    ? "请重新拍手掌：掌心朝上，手掌占满画面，尽量不要拍到键盘、桌面杂物，光线要亮。"
    : "请重新拍正脸：脸在画面中间，额头到下巴完整，少拍头发和衣服，光线要亮。";

const retakeResult = ({ kind, imageMeta, subjectBox, imageQuality, notes, reason }) => ({
  kind,
  imageMeta,
  subjectBox: subjectBox || fallbackSubjectBox(kind),
  imageQuality: imageQuality || "partial",
  notes: [...(notes || []), reason, retakeAdvice(kind)],
  features: [],
  needsRetake: true,
  retakeReason: reason,
});

const validFeatureGeometry = ({ kind, featureId, box, segments, subjectBox }) => {
  if (!box && !segments.length) return false;

  if (kind === "palm") {
    if (segments.length && !allSegmentsInside(segments, subjectBox)) return false;
    if (box && !boxInsideRegion(box, subjectBox)) return false;
    if (palmMainLineIds.has(featureId)) return validPalmLine(featureId, segments, subjectBox);
    if (!box) return false;
    return box.width <= subjectBox.width * 0.72 && box.height <= subjectBox.height * 0.72;
  }

  if (!box || !boxInsideRegion(box, subjectBox)) return false;
  const limit = faceBoxLimits[featureId] || { width: 46, height: 32 };
  if (box.width > Math.min(limit.width, subjectBox.width * 0.82)) return false;
  if (box.height > Math.min(limit.height, subjectBox.height * 0.45)) return false;
  return validFaceBox(featureId, box, subjectBox);
};

export const normalizeVisionResult = ({ kind, imageMeta, parsed }) => {
  const catalog = catalogFor(kind);
  const catalogMap = byId(kind);
  const features = Array.isArray(parsed.features) ? parsed.features : [];
  const subjectBox = subjectBoxFrom(kind, parsed);
  if (!subjectBox) {
    return retakeResult({
      kind,
      imageMeta,
      subjectBox: fallbackSubjectBox(kind),
      imageQuality: parsed.imageQuality || "unknown",
      notes: [
        ...(Array.isArray(parsed.notes) ? parsed.notes.slice(0, 3) : []),
      ],
      reason: kind === "palm" ? "这张照片没有看清手掌主体，请重新拍一张掌心更完整的照片。" : "这张照片没有看清正脸主体，请重新拍一张五官更完整的照片。",
    });
  }

  const rejected = [];
  const normalizedFeatures = features
    .slice(0, 18)
    .map((feature, index) => {
      const known = matchCatalogItem(catalog, catalogMap, feature, index);
      if (!known) {
        rejected.push(feature.name || feature.featureId || "未知标注");
        return null;
      }
      const confidence = Number(feature.confidence ?? 0.5);
      const segments = kind === "face" ? [] : normalizeSegments(feature.segments, feature.points);
      const pointCount = segments.reduce((sum, segment) => sum + segment.length, 0);
      const minLinePoints = {
        life_line: 5,
        head_line: 5,
        heart_line: 5,
        fate_line: 3,
        marriage_line: 2,
      }[known.id] || 4;
      const needsLineReview = kind === "palm" && palmMainLineIds.has(known.id) && pointCount < minLinePoints;
      const faceLowConfidence = kind === "face" && confidence < 0.72;
      const box = normalizeBox(feature.box) || segmentsBounds(segments) || fallbackBox(index);
      const cleanSegments = needsLineReview ? [] : segments;
      const geometryOk = validFeatureGeometry({
        kind,
        featureId: known.id,
        box,
        segments: cleanSegments,
        subjectBox,
      });
      if (!geometryOk) {
        rejected.push(feature.name || known.name);
        return null;
      }
      return {
        featureId: known.id,
        name: feature.name || known.name,
        category: feature.category || known.category,
        points: cleanSegments[0] || [],
        segments: cleanSegments,
        box,
        confidence: Math.max(0, Math.min(1, confidence)),
        evidence: String(feature.evidence || ""),
        plainSummary: String(feature.plainSummary || ""),
        advice: String(feature.advice || ""),
        needsReview: Boolean(feature.needsReview || confidence < 0.58 || needsLineReview || faceLowConfidence),
        interpretation: known.interpretation,
        sourceTitle: known.sourceTitle,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (featurePriority.get(a.featureId) ?? 99) - (featurePriority.get(b.featureId) ?? 99));

  const result = {
    kind,
    imageMeta,
    subjectBox,
    imageQuality: parsed.imageQuality || "unknown",
    notes: [
      ...(Array.isArray(parsed.notes) ? parsed.notes.slice(0, 3) : []),
      ...(rejected.length ? [`已自动丢弃 ${rejected.length} 个位置不合理的标注`] : []),
    ],
    features: normalizedFeatures,
  };
  const reliableCount = normalizedFeatures.filter((feature) => !feature.needsReview).length;
  const mainPalmCount = normalizedFeatures.filter((feature) => ["life_line", "head_line", "heart_line"].includes(feature.featureId)).length;
  if (kind === "palm" && (reliableCount < 2 || mainPalmCount < 2)) {
    return retakeResult({
      ...result,
      reason: "这张手掌照没有识别到至少两条可靠主掌纹，继续分析容易乱画。",
    });
  }
  if (kind === "face" && reliableCount < 2) {
    return retakeResult({
      ...result,
      reason: "这张面部照可确认的位置太少，继续分析容易乱框。",
    });
  }
  return result;
};

const asParagraphs = (value) => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).slice(0, 5);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
};

const normalizeSections = (sections) => {
  if (!Array.isArray(sections)) return [];
  return sections
    .map((section) => ({
      title: String(section?.title || "照片分析").slice(0, 40),
      paragraphs: asParagraphs(section?.paragraphs || section?.content || section?.text),
    }))
    .filter((section) => section.paragraphs.length)
    .slice(0, 8);
};

const sectionsToText = (sections) =>
  normalizeSections(sections)
    .map((section) => [`【${section.title}】`, ...section.paragraphs].join("\n"))
    .join("\n\n");

const normalizeTextAnalysisResult = ({ kind, imageMeta, parsed }) => {
  const usable = parsed.usable !== false && parsed.needsRetake !== true;
  const imageQuality = parsed.imageQuality || parsed.photoQuality || "unknown";
  if (!usable) {
    return retakeResult({
      kind,
      imageMeta,
      imageQuality,
      notes: asParagraphs(parsed.notes),
      reason: parsed.retakeReason || parsed.reason || (kind === "palm" ? "这张手掌照不够完整清楚，暂时不分析。" : "这张面部照不够完整清楚，暂时不分析。"),
    });
  }

  const catalogMap = byId(kind);
  const features = (Array.isArray(parsed.features) ? parsed.features : [])
    .map((feature, index) => {
      const known = catalogMap.get(feature?.featureId);
      return {
        featureId: known?.id || String(feature?.featureId || `analysis_${index + 1}`).slice(0, 40),
        name: String(feature?.name || known?.name || "观察点").slice(0, 40),
        category: String(feature?.category || known?.category || "照片分析").slice(0, 40),
        confidence: Math.max(0, Math.min(1, Number(feature?.confidence ?? 0.78))),
        evidence: String(feature?.evidence || feature?.observed || "").slice(0, 220),
        plainSummary: String(feature?.plainSummary || feature?.summary || "").slice(0, 260),
        advice: String(feature?.advice || "").slice(0, 260),
        needsReview: Boolean(feature?.needsReview),
        interpretation: known?.interpretation || "",
        sourceTitle: known?.sourceTitle || "",
      };
    })
    .filter((feature) => feature.name !== "观察点" || feature.plainSummary || feature.evidence)
    .slice(0, kind === "palm" ? 8 : 10);

  const sections = normalizeSections(parsed.sections);
  const reportText = String(parsed.reportText || parsed.analysis || parsed.report || sectionsToText(sections) || parsed.photoSummary || "").trim();
  return {
    kind,
    imageMeta,
    imageQuality,
    notes: asParagraphs(parsed.notes),
    photoSummary: String(parsed.photoSummary || parsed.summary || "").slice(0, 400),
    reportText,
    sections,
    reading: asParagraphs(parsed.reading).slice(0, 6),
    features,
  };
};

const ageFromBirthDate = (birthDate) => {
  const date = new Date(String(birthDate || ""));
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const monthDelta = now.getMonth() - date.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < date.getDate())) age -= 1;
  return age > 0 && age < 130 ? `${age}岁` : "";
};

const genderText = (gender) => (gender === "female" ? "女" : gender === "male" ? "男" : "未填写");

const subjectProfile = (birth = {}) =>
  [
    `姓名/代称：${birth.personName || "未填写"}`,
    `性别：${genderText(birth.gender)}`,
    `年龄：${ageFromBirthDate(birth.birthDate) || "未填写"}`,
    `出生日期：${birth.birthDate || "未填写"}`,
    `出生时间：${birth.birthTime || "未填写"}`,
    `出生地备注：${birth.birthPlace || "未填写"}`,
  ].join("；");

export const analyzeImage = async ({ kind, imageDataUrl, imageMeta, birth = {}, userCorrection = "", env }) => {
  if (!String(imageDataUrl || "").startsWith("data:image/")) {
    throw new Error("图片格式无效。");
  }

  const catalog = catalogFor(kind);
  const names = catalog.map((item) => `${item.id}:${item.name}`).join("；");
  const correctionGuide = userCorrection
    ? `用户反馈说：${userCorrection}。请按这句反馈重新看照片和重新分析，不要让用户标注。`
    : "";
  const palmGuide =
    "你现在只做手掌照片原始分析，不输出坐标，不画线，不要求用户标注。先快速判断照片是否完整清晰：掌心是否朝上、手掌是否完整、掌纹是否能看、光线是否够。照片不合格 usable=false，并告诉用户怎么重拍。照片合格就暴力直接分析：整体手型掌色、生命线、智慧线、感情线、事业线、婚姻线、明显特点、现实建议。看不清的地方直接写“不够清楚，先不强断”。";
  const faceGuide =
    "你现在只做面部照片原始分析，不输出坐标，不画框，不要求用户标注。先快速判断照片是否完整清晰：是否正脸、额头到下巴是否完整、五官是否能看、光线是否够。照片不合格 usable=false，并告诉用户怎么重拍。照片合格就暴力直接分析：整体气色、额头、眉毛、眼睛、鼻子、人中/嘴唇、下巴、明显特点、现实建议。看不清的地方直接写“不够清楚，先不强断”。";
  const prompt =
    `你是传统文化照片分析助手。用户信息：${subjectProfile(birth)}。${correctionGuide}${kind === "palm" ? palmGuide : faceGuide}` +
    `必须只返回 JSON，不要 Markdown。可选观察点 id：${names}。` +
    `返回格式：{"usable":true,"imageQuality":"clear|partial|blurry","photoSummary":"一句话说照片是否能用","reportText":"直接给用户看的完整分析，按段落写，短平快，像截图示例那样有【核心画像】【性格与思维】【事业与财富】【感情与家庭】【建议】等小标题。","features":[{"featureId":"nose_tip","name":"鼻子","confidence":0.82,"plainSummary":"一句观察","advice":"一句建议"}]}。如果照片不合格，返回 {"usable":false,"imageQuality":"partial","retakeReason":"原因","notes":["请重新拍..."],"reportText":"","features":[]}。` +
    `注意：这只是传统文化娱乐参考，不要医学、投资、法律结论，不要吓人，不要绝对化。`;

  const model = env.AI_VISION_MODEL || "qwen3.6-plus";
  const visionTimeout = timeoutMs(env.AI_VISION_TIMEOUT_MS, 55000);
  const { content } = await callAiChat({
    env,
    model,
    temperature: 0,
    maxTokens: 900,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    timeout: visionTimeout,
    timeoutMessage: `看图超时了。这次没有在 ${Math.round(visionTimeout / 1000)} 秒内返回，请换一张更近、更亮、背景更少的照片后重试。`,
  });
  const parsed = parseAnalysis(content);
  return normalizeTextAnalysisResult({ kind, imageMeta, parsed });
};

const summarizeFeatures = (result) =>
  (result?.features || []).slice(0, 10).map((feature) => ({
    featureId: feature.featureId,
    name: feature.name,
    category: feature.category,
    confidence: feature.confidence,
    evidence: feature.evidence,
    plainSummary: feature.plainSummary,
    advice: feature.advice,
    needsReview: feature.needsReview,
  }));

const compactAnalysis = (result) =>
  [
    result?.photoSummary ? `照片判断：${result.photoSummary}` : "",
    result?.reportText || "",
    ...(result?.sections || []).map((section) => [`【${section.title}】`, ...(section.paragraphs || [])].join("\n")),
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 5000);

export const generatePlainReading = async ({ bazi, palm, face, env }) => {
  if (!env.AI_API_KEY) return null;

  const model = env.AI_REPORT_MODEL || "qwen3.7-max";
  const input = {
    baziSummary: bazi.summary,
    baziElements: bazi.elements,
    palmPhotoSummary: palm?.photoSummary || "",
    facePhotoSummary: face?.photoSummary || "",
    palmRawReport: compactAnalysis(palm),
    faceRawReport: compactAnalysis(face),
    palmSections: palm?.sections || [],
    faceSections: face?.sections || [],
    palmFeatures: summarizeFeatures(palm),
    faceFeatures: summarizeFeatures(face),
  };
  const prompt =
    "你是传统文化测算报告助手。输入里已经有 Qwen3.6 Plus 对手掌照片和面部照片的原始分析，请以这些原文为主，再结合八字信息做精炼总结，不要重新编照片里看不到的东西。请按真人看图聊天的口吻写报告，格式参考：先给【核心画像】，再分【性格与思维】【事业与财富】【感情与家庭】【现实建议】【一句话总结】。" +
    "要求：普通人能听懂；像认真给朋友分析；不要吓人，不要绝对化，不要编医学/投资结论；可以说“传统里一般会理解为”。" +
    "如果输入没有某条线，就写“这张图里这条线不够清楚，先不强断”。现实建议要温和实用。" +
    "输出必须是 JSON：{\"sections\":[{\"title\":\"整体特点\",\"paragraphs\":[\"...\"]}],\"reading\":[\"一句结论或建议\",...]}。" +
    "sections 输出 7-8 段，每段 title 清楚，paragraphs 每段 2-5 句短句；reading 输出 4 条摘要。输入：" +
    JSON.stringify(input);

  try {
    const { content } = await callAiChat({
      env,
      model,
      temperature: 0.35,
      maxTokens: 1200,
      messages: [{ role: "user", content: prompt }],
      timeout: timeoutMs(env.AI_REPORT_TIMEOUT_MS, 45000),
      timeoutMessage: "报告生成超时了，请稍后重试。",
    });
    const parsed = parseJson(content);
    return {
      sections: Array.isArray(parsed.sections) ? parsed.sections.slice(0, 9) : [],
      reading: Array.isArray(parsed.reading) ? parsed.reading.slice(0, 6).map(String) : [],
    };
  } catch {
    return null;
  }
};
