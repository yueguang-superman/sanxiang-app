import { clientIp, json } from "./http.js";

const dayKey = () => new Date().toISOString().slice(0, 10);

const fallbackStore = new Map();

export const dailyLimit = (env) => Number(env.DAILY_LIMIT || 3);

export const requireAccess = async (request, env, body, { consume = false } = {}) => {
  const expected = env.ACCESS_CODE || "moonlight-lgl";
  const provided = String(body.accessCode || "");
  if (!provided || provided !== expected) {
    return { error: json({ error: "访问码不正确。" }, 401) };
  }

  const anonymousId = String(body.anonymousId || "anonymous").slice(0, 80);
  const ip = clientIp(request);
  const key = `quota:${dayKey()}:${anonymousId}:${ip}`;
  const limit = dailyLimit(env);
  const kv = env.RATE_LIMIT_KV;

  let used = 0;
  if (kv) {
    used = Number((await kv.get(key)) || 0);
  } else {
    used = Number(fallbackStore.get(key) || 0);
  }

  if (consume && used >= limit) {
    return {
      error: json(
        {
          error: `今日免费次数已用完。每日限 ${limit} 次，明天再来。`,
          remaining: 0,
        },
        429,
      ),
    };
  }

  if (consume) {
    used += 1;
    if (kv) {
      await kv.put(key, String(used), { expirationTtl: 60 * 60 * 30 });
    } else {
      fallbackStore.set(key, used);
    }
  }

  return {
    ok: true,
    remaining: Math.max(0, limit - used),
    limit,
    used,
  };
};
