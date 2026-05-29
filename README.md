# 三相命理测算

月光LGL制作。小范围公网体验版，适合 10-20 人使用。

## 功能

- 共享访问码进入，不做账号系统。
- 上传手掌图、面部图，前端压缩后传到 Cloudflare Pages Functions。
- 后端调用 OpenAI-compatible 视觉 AI，返回手相/面相特殊点坐标、置信度和解释。
- 后端排四柱八字，生成五行、十神和三相合参报告。
- 图片只在本次请求中使用，不落长期存储。

## 部署

1. 把 `命理测算软件` 目录推到 GitHub 仓库。
2. 在 Cloudflare Pages 新建项目，连接 GitHub。
3. Build command 留空，Build output directory 填 `.`。
4. 在 Cloudflare Pages 的 Settings -> Environment variables 配置：
   - `ACCESS_CODE`：共享访问码。
   - `DAILY_LIMIT`：每日次数，比如 `20`。
   - `AI_API_KEY`：通义千问 / 阿里云百炼 API Key。
   - `AI_BASE_URL`：默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`，可不改。
   - `AI_MODEL`：默认 `qwen3.6-flash`，低成本优先；需要更强效果时再换更高阶视觉模型。
5. 建议创建 Cloudflare KV，并绑定为 `RATE_LIMIT_KV`，用于稳定记录每日限次。

## 通义千问配置

本项目默认走阿里云百炼 DashScope 的 OpenAI 兼容接口：

- `AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`
- `AI_MODEL=qwen3.6-flash`
- `AI_API_KEY=你的百炼 API Key`

不要把 `AI_API_KEY` 写进前端代码或 GitHub 仓库。请只放在 Cloudflare Pages 的环境变量或 Secret 里。

## 低成本建议

- 小范围使用时先用 Cloudflare 免费层。
- 图片在前端压缩，减少视觉 AI 成本。
- 访问码 + 每日限次避免接口被乱用。
- 后期人数多了再接登录、支付、报告历史和国内备案部署。

## 传统文化声明

报告取意于《周易》《麻衣神相》《神相全编》《三命通会》《滴天髓》《渊海子平》等术数传统，仅作文化娱乐与自我观察参考，不作为医学、法律、投资或人生重大决策依据。
