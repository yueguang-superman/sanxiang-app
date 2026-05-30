import { normalizeVisionResult } from "../functions/_shared/ai.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const featureIds = (result) => result.features.map((feature) => feature.featureId).sort();

const palmBad = normalizeVisionResult({
  kind: "palm",
  imageMeta: { width: 960, height: 1280 },
  parsed: {
    subjectBox: { x: 10, y: 2, width: 82, height: 90 },
    features: [
      {
        featureId: "heart_line",
        name: "感情线",
        confidence: 0.9,
        segments: [[{ x: 38, y: 24 }, { x: 64, y: 34 }, { x: 94, y: 43 }]],
        box: { x: 36, y: 22, width: 58, height: 24 },
      },
      {
        featureId: "head_line",
        name: "智慧线",
        confidence: 0.9,
        segments: [[{ x: 28, y: 42 }, { x: 48, y: 62 }, { x: 76, y: 84 }]],
        box: { x: 26, y: 40, width: 50, height: 44 },
      },
      {
        featureId: "fate_line",
        name: "事业线候选",
        confidence: 0.86,
        box: { x: 46, y: 45, width: 12, height: 56 },
      },
    ],
  },
});
assert(palmBad.features.length === 0, "错误掌纹应该全部被拦截");
assert(palmBad.needsRetake === true, "错误掌纹应该要求重新上传照片");

const palmGood = normalizeVisionResult({
  kind: "palm",
  imageMeta: { width: 960, height: 1280 },
  parsed: {
    subjectBox: { x: 10, y: 5, width: 80, height: 90 },
    features: [
      {
        featureId: "life_line",
        name: "生命线",
        confidence: 0.88,
        segments: [[{ x: 34, y: 38 }, { x: 27, y: 48 }, { x: 22, y: 62 }, { x: 23, y: 76 }, { x: 30, y: 88 }]],
        box: { x: 20, y: 36, width: 18, height: 54 },
      },
      {
        featureId: "head_line",
        name: "智慧线",
        confidence: 0.86,
        segments: [[{ x: 32, y: 48 }, { x: 44, y: 53 }, { x: 56, y: 58 }, { x: 68, y: 65 }, { x: 78, y: 72 }]],
        box: { x: 30, y: 46, width: 50, height: 28 },
      },
      {
        featureId: "heart_line",
        name: "感情线",
        confidence: 0.84,
        segments: [[{ x: 76, y: 39 }, { x: 66, y: 38 }, { x: 56, y: 38 }, { x: 45, y: 40 }, { x: 34, y: 43 }]],
        box: { x: 32, y: 36, width: 46, height: 12 },
      },
    ],
  },
});
assert(featureIds(palmGood).join(",") === "head_line,heart_line,life_line", "清楚的三大主纹应该保留");
assert(!palmGood.needsRetake, "清楚掌纹不应该要求重拍");

const palmNoSubject = normalizeVisionResult({
  kind: "palm",
  imageMeta: { width: 960, height: 1280 },
  parsed: {
    features: [
      {
        featureId: "life_line",
        name: "生命线",
        confidence: 0.92,
        segments: [[{ x: 34, y: 38 }, { x: 27, y: 48 }, { x: 22, y: 62 }, { x: 23, y: 76 }, { x: 30, y: 88 }]],
        box: { x: 20, y: 36, width: 18, height: 54 },
      },
    ],
  },
});
assert(palmNoSubject.needsRetake === true, "AI 未锁定手掌区域时应该要求重拍");

const palmTooFewMainLines = normalizeVisionResult({
  kind: "palm",
  imageMeta: { width: 960, height: 1280 },
  parsed: {
    subjectBox: { x: 10, y: 5, width: 80, height: 90 },
    features: [
      {
        featureId: "life_line",
        name: "生命线",
        confidence: 0.88,
        segments: [[{ x: 34, y: 38 }, { x: 27, y: 48 }, { x: 22, y: 62 }, { x: 23, y: 76 }, { x: 30, y: 88 }]],
        box: { x: 20, y: 36, width: 18, height: 54 },
      },
    ],
  },
});
assert(palmTooFewMainLines.needsRetake === true, "只识别到一条主掌纹时应该要求重拍");

const faceBad = normalizeVisionResult({
  kind: "face",
  imageMeta: { width: 960, height: 1280 },
  parsed: {
    subjectBox: { x: 15, y: 8, width: 70, height: 80 },
    features: [
      { featureId: "brows", name: "眉形", confidence: 0.9, box: { x: 10, y: 15, width: 82, height: 16 } },
      { featureId: "eyes", name: "眼神眼白", confidence: 0.9, box: { x: 5, y: 32, width: 90, height: 20 } },
      { featureId: "mouth", name: "口唇", confidence: 0.9, box: { x: 36, y: 82, width: 25, height: 18 } },
    ],
  },
});
assert(faceBad.features.length === 0, "错误面部大框应该全部被拦截");
assert(faceBad.needsRetake === true, "错误面部标注应该要求重新上传照片");

const faceGood = normalizeVisionResult({
  kind: "face",
  imageMeta: { width: 960, height: 1280 },
  parsed: {
    subjectBox: { x: 20, y: 10, width: 60, height: 78 },
    features: [
      { featureId: "yintang", name: "印堂", confidence: 0.86, box: { x: 45, y: 28, width: 10, height: 10 } },
      { featureId: "eyes", name: "眼睛", confidence: 0.86, box: { x: 28, y: 38, width: 44, height: 10 } },
      { featureId: "nose_tip", name: "鼻头鼻翼", confidence: 0.86, box: { x: 42, y: 50, width: 16, height: 14 } },
      { featureId: "mouth", name: "口唇", confidence: 0.86, box: { x: 38, y: 62, width: 24, height: 10 } },
    ],
  },
});
assert(featureIds(faceGood).join(",") === "eyes,mouth,nose_tip,yintang", "合理面部小框应该保留");
assert(!faceGood.needsRetake, "清楚面部不应该要求重拍");

console.log("Annotation rules passed");
