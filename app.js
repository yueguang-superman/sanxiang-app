const $ = (id) => document.getElementById(id);

const state = {
  accessCode: sessionStorage.getItem("accessCode") || "",
  anonymousId: localStorage.getItem("anonymousId") || crypto.randomUUID(),
  palmImage: null,
  faceImage: null,
  palmResult: null,
  faceResult: null,
};

localStorage.setItem("anonymousId", state.anonymousId);

const api = async (path, body) => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accessCode: state.accessCode,
      anonymousId: state.anonymousId,
      ...body,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `请求失败：${response.status}`);
  }
  return data;
};

const setMessage = (id, text, isError = false) => {
  const node = $(id);
  node.textContent = text;
  node.classList.toggle("error", isError);
};

const unlock = async () => {
  state.accessCode = $("accessCode").value.trim();
  if (!state.accessCode) {
    setMessage("accessMessage", "先输入共享访问码。", true);
    return;
  }

  setMessage("accessMessage", "正在检查访问码...");
  try {
    const result = await api("/api/access", {});
    sessionStorage.setItem("accessCode", state.accessCode);
    $("workspace").classList.remove("locked");
    $("quotaStatus").textContent = `今日剩余 ${result.remaining} 次`;
    setMessage("accessMessage", "已进入，可以开始测算。");
  } catch (error) {
    $("workspace").classList.add("locked");
    setMessage("accessMessage", error.message, true);
  }
};

const compressImage = (file, maxSize = 1400, quality = 0.82) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({
          dataUrl: canvas.toDataURL("image/jpeg", quality),
          width: canvas.width,
          height: canvas.height,
        });
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const loadImage = async (kind, file) => {
  if (!file) return;
  const image = await compressImage(file);
  state[`${kind}Image`] = image;
  state[`${kind}Result`] = null;

  const preview = $(`${kind}Preview`);
  preview.src = image.dataUrl;
  preview.hidden = false;
  $(`${kind}Empty`).hidden = true;
  $(`${kind}Marks`).innerHTML = "";
  setMessage(`${kind}Status`, `已压缩：${image.width}×${image.height}`);
};

const escapeHtml = (text = "") =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const normalizeBox = (box = {}) => {
  const rawX = Number.isFinite(Number(box.x ?? box.left)) ? Number(box.x ?? box.left) : 0;
  const rawY = Number.isFinite(Number(box.y ?? box.top)) ? Number(box.y ?? box.top) : 0;
  const x = Math.max(0, Math.min(96, rawX));
  const y = Math.max(0, Math.min(96, rawY));
  const width = Number.isFinite(Number(box.width ?? box.w)) ? Number(box.width ?? box.w) : 12;
  const height = Number.isFinite(Number(box.height ?? box.h)) ? Number(box.height ?? box.h) : 8;
  return {
    x,
    y,
    width: Math.max(3, Math.min(100 - x, width)),
    height: Math.max(3, Math.min(100 - y, height)),
  };
};

const normalizePoint = (point = {}) => ({
  x: Math.max(0, Math.min(100, Number(point.x ?? 0))),
  y: Math.max(0, Math.min(100, Number(point.y ?? 0))),
});

const drawMarks = (kind, result) => {
  const svg = $(`${kind}Marks`);
  svg.innerHTML = "";
  const features = result?.features || [];
  for (const feature of features) {
    const box = normalizeBox(feature.box);
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const points = (feature.points || []).map(normalizePoint).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

    if (points.length >= 2) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      line.setAttribute("class", "mark-line");
      line.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
      group.append(line);
    } else {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("class", "mark-box");
      rect.setAttribute("x", box.x);
      rect.setAttribute("y", box.y);
      rect.setAttribute("width", box.width);
      rect.setAttribute("height", box.height);
      rect.setAttribute("rx", 1.4);
      group.append(rect);
    }

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "mark-label");
    label.setAttribute("x", Math.min(94, points[0]?.x ?? box.x + 1));
    label.setAttribute("y", Math.max(5, (points[0]?.y ?? box.y) - 1));
    label.textContent = feature.name || feature.featureId || "特殊点";

    group.append(label);
    svg.append(group);
  }
};

const analyze = async (kind) => {
  const image = state[`${kind}Image`];
  if (!image) {
    setMessage(`${kind}Status`, "请先选择图片。", true);
    return null;
  }

  const label = kind === "palm" ? "手掌照片" : "面部照片";
  setMessage(`${kind}Status`, `AI 正在分析${label}...`);
  try {
    const result = await api(`/api/analyze/${kind}`, {
      imageDataUrl: image.dataUrl,
      imageMeta: { width: image.width, height: image.height },
    });
    state[`${kind}Result`] = result;
    drawMarks(kind, result);
    const count = result.features?.length || 0;
    const emptyTip = kind === "palm" ? "没识别到清楚掌纹，请换一张掌心更近、更清晰的照片。" : "没识别到清楚面部特征，请换一张正脸照片。";
    setMessage(`${kind}Status`, count ? `已标出 ${count} 个位置` : emptyTip, !count);
    if (typeof result.remaining === "number") {
      $("quotaStatus").textContent = `今日剩余 ${result.remaining} 次`;
    }
    return result;
  } catch (error) {
    setMessage(`${kind}Status`, error.message, true);
    return null;
  }
};

const birthPayload = () => ({
  personName: $("personName").value.trim() || "求测者",
  gender: $("gender").value,
  birthDate: $("birthDate").value,
  birthTime: $("birthTime").value,
  timezone: Number($("timezone").value),
  birthPlace: $("birthPlace").value.trim(),
});

const renderFeatureList = (title, result) => {
  const features = result?.features || [];
  if (!features.length) {
    return `<section class="report-section"><h3>${title}</h3><p class="source">这张图暂时没有识别到清楚位置。建议重新上传更清晰的照片：画面里只放手掌或正脸，光线亮一点，不要遮挡。</p></section>`;
  }
  const items = features
    .map((feature) => {
      const confidence = Math.round((feature.confidence ?? 0) * 100);
      const review = feature.needsReview ? "，待复核" : "";
      return `<li><strong>${escapeHtml(feature.name)}</strong>：${escapeHtml(feature.evidence || feature.interpretation || "已识别到这个位置")} <span class="mini">可信度 ${confidence}%${review}</span></li>`;
    })
    .join("");
  return `<section class="report-section"><h3>${title}</h3><ul>${items}</ul></section>`;
};

const renderReport = (report) => {
  const bazi = report.bazi;
  const elements = bazi.elements || {};
  const max = Math.max(1, ...Object.values(elements));
  const elementBars = ["木", "火", "土", "金", "水"]
    .map((name) => {
      const value = elements[name] || 0;
      return `<div class="element"><label>${name} ${value}</label><div class="bar"><i style="width:${(value / max) * 100}%"></i></div></div>`;
    })
    .join("");

  $("report").innerHTML = `
    <div class="report-title">
      <div>
        <h2>${escapeHtml(report.subject)}综合测算报告</h2>
        <p>月光LGL制作。内容只作传统文化娱乐参考，不等于现实承诺。</p>
      </div>
      <div class="score"><span>综合气势</span><strong>${report.score}</strong></div>
    </div>

    <section class="report-section">
      <h3>四柱盘式</h3>
      <div class="pillar-row">
        ${bazi.pillars.map((p) => `<div class="pillar"><span>${p.label}</span><strong>${p.value}</strong></div>`).join("")}
      </div>
    </section>

    <section class="report-section">
      <h3>五行统计</h3>
      <div class="element-bars">${elementBars}</div>
      <p class="source">${escapeHtml(bazi.summary)}</p>
    </section>

    ${renderFeatureList("手掌识别结果", report.palm)}
    ${renderFeatureList("面部识别结果", report.face)}

    <section class="report-section">
      <h3>综合解读</h3>
      <ul>${report.reading.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>

    <section class="report-section">
      <h3>参考来源</h3>
      <p class="source">参考《周易》的取象方法，也借用了《麻衣神相》《神相全编》里的手相、面相部位说法，以及《三命通会》《滴天髓》《渊海子平》里的四柱五行思路。AI 负责看图标位置，解释由规则库生成。</p>
    </section>
  `;
};

const submitReport = async (event) => {
  event.preventDefault();
  if (!$("birthDate").value || !$("birthTime").value) {
    $("report").innerHTML = `<div class="report-empty"><h2>缺少生辰</h2><p class="error">请先填写出生日期和时间。</p></div>`;
    return;
  }

  $("report").innerHTML = `<div class="report-empty"><h2>正在生成报告</h2><p>正在分析生日、手掌照片和面部照片...</p></div>`;

  if (state.palmImage && !state.palmResult) await analyze("palm");
  if (state.faceImage && !state.faceResult) await analyze("face");

  try {
    const report = await api("/api/report", {
      birth: birthPayload(),
      palm: state.palmResult,
      face: state.faceResult,
    });
    renderReport(report);
  } catch (error) {
    $("report").innerHTML = `<div class="report-empty"><h2>生成失败</h2><p class="error">${escapeHtml(error.message)}</p></div>`;
  }
};

const fillDemo = () => {
  $("personName").value = "月下问命者";
  $("gender").value = "male";
  $("birthDate").value = "1992-08-18";
  $("birthTime").value = "21:35";
  $("timezone").value = "8";
  $("birthPlace").value = "上海";
};

const clearAll = () => {
  $("readingForm").reset();
  $("birthTime").value = "12:00";
  for (const kind of ["palm", "face"]) {
    state[`${kind}Image`] = null;
    state[`${kind}Result`] = null;
    $(`${kind}Preview`).hidden = true;
    $(`${kind}Preview`).removeAttribute("src");
    $(`${kind}Empty`).hidden = false;
    $(`${kind}Marks`).innerHTML = "";
    setMessage(`${kind}Status`, "");
  }
};

$("unlockButton").addEventListener("click", unlock);
$("accessCode").addEventListener("keydown", (event) => {
  if (event.key === "Enter") unlock();
});
$("palmImage").addEventListener("change", (event) => loadImage("palm", event.target.files[0]));
$("faceImage").addEventListener("change", (event) => loadImage("face", event.target.files[0]));
$("analyzePalm").addEventListener("click", () => analyze("palm"));
$("analyzeFace").addEventListener("click", () => analyze("face"));
$("readingForm").addEventListener("submit", submitReport);
$("fillDemo").addEventListener("click", fillDemo);
$("clearAll").addEventListener("click", clearAll);

if (state.accessCode) {
  $("accessCode").value = state.accessCode;
  unlock();
}
