import { requireSuperAdmin } from "./_auth.js";

const encoder = new TextEncoder();
const json = (data, status = 200) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store" }
});

function base64url(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function googleAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3500
  }));
  const unsigned = header + "." + claim;
  const pem = serviceAccount.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", binary,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const assertion = unsigned + "." + base64url(signature);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "Google erişim anahtarı alınamadı.");
  return data.access_token;
}

async function gaReport(token, propertyId, body) {
  const response = await fetch("https://analyticsdata.googleapis.com/v1beta/properties/" + encodeURIComponent(propertyId) + ":runReport", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Google Analytics raporu alınamadı.");
  return data;
}

const metric = (row, index) => Number(row.metricValues?.[index]?.value || 0);
const dimension = (row, index) => row.dimensionValues?.[index]?.value || "(Bilinmiyor)";

async function getGoogleAnalytics(env, startDate, endDate) {
  if (!env.GA4_PROPERTY_ID || !env.GA4_SERVICE_ACCOUNT_JSON) {
    return { configured: false, error: "Google Analytics bağlantısı için GA4_PROPERTY_ID ve GA4_SERVICE_ACCOUNT_JSON ayarlanmalı." };
  }
  const account = JSON.parse(env.GA4_SERVICE_ACCOUNT_JSON);
  const token = await googleAccessToken(account);
  const range = { startDate, endDate };
  const [totals, countries, daily, events, pages] = await Promise.all([
    gaReport(token, env.GA4_PROPERTY_ID, {
      dateRanges: [range],
      metrics: [{ name: "totalUsers" }, { name: "sessions" }, { name: "screenPageViews" }, { name: "eventCount" }]
    }),
    gaReport(token, env.GA4_PROPERTY_ID, {
      dateRanges: [range],
      dimensions: [{ name: "country" }],
      metrics: [{ name: "sessions" }, { name: "screenPageViews" }, { name: "eventCount" }],
      limit: "15",
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }]
    }),
    gaReport(token, env.GA4_PROPERTY_ID, {
      dateRanges: [range],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "screenPageViews" }],
      limit: "31",
      orderBys: [{ dimension: { dimensionName: "date" } }]
    }),
    gaReport(token, env.GA4_PROPERTY_ID, {
      dateRanges: [range],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      limit: "100"
    }),
    gaReport(token, env.GA4_PROPERTY_ID, {
      dateRanges: [range],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      limit: "10",
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }]
    })
  ]);
  const total = totals.rows?.[0];
  const eventRows = events.rows || [];
  const eventCount = name => eventRows.filter(row => name.test(dimension(row, 0))).reduce((sum, row) => sum + metric(row, 0), 0);
  return {
    configured: true,
    totals: {
      users: metric(total, 0),
      sessions: metric(total, 1),
      pageViews: metric(total, 2),
      events: metric(total, 3),
      clicks: eventCount(/click|file_download|form_submit|generate_lead|select_content/i),
      scrolls: eventCount(/scroll/i)
    },
    countries: (countries.rows || []).map(row => ({
      country: dimension(row, 0), sessions: metric(row, 0),
      pageViews: metric(row, 1), events: metric(row, 2)
    })),
    daily: (daily.rows || []).map(row => ({
      date: dimension(row, 0),
      sessions: metric(row, 0), pageViews: metric(row, 1)
    })),
    pages: (pages.rows || []).map(row => ({ path: dimension(row, 0), pageViews: metric(row, 0) }))
  };
}

async function getCloudflare(env, startDate, endDate) {
  if (!env.CF_ACCOUNT_ID || !env.CF_ZONE_TAG || !env.CF_ANALYTICS_API_TOKEN) {
    return { configured: false, error: "Cloudflare bağlantısı için CF_ACCOUNT_ID, CF_ZONE_TAG ve CF_ANALYTICS_API_TOKEN ayarlanmalı." };
  }
  const query = `query ZoneTraffic($zone: String!, $from: Date!, $to: Date!) {
    viewer {
      zones(filter: { zoneTag: $zone }) {
        httpRequests1dGroups(limit: 100, filter: { date_ge: $from, date_le: $to }) {
          dimensions { date }
          sum { requests }
          uniq { uniques }
        }
        countryTraffic: httpRequests1dGroups(limit: 100, filter: { date_ge: $from, date_le: $to }) {
          dimensions { clientCountryName }
          sum { requests }
          uniq { uniques }
        }
      }
    }
  }`;
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.CF_ANALYTICS_API_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { zone: env.CF_ZONE_TAG, from: startDate, to: endDate } })
  });
  const data = await response.json();
  if (!response.ok || data.errors?.length) throw new Error(data.errors?.[0]?.message || "Cloudflare Analytics verisi alınamadı.");
  const zone = data.data?.viewer?.zones?.[0];
  if (!zone) throw new Error("Cloudflare Zone bulunamadı. Zone ID değerini kontrol edin.");
  return {
    configured: true,
    totals: {
      requests: (zone.httpRequests1dGroups || []).reduce((sum, row) => sum + Number(row.sum?.requests || 0), 0),
      uniqueVisitors: (zone.httpRequests1dGroups || []).reduce((sum, row) => sum + Number(row.uniq?.uniques || 0), 0)
    },
    daily: (zone.httpRequests1dGroups || []).map(row => ({
      date: row.dimensions.date,
      requests: Number(row.sum?.requests || 0),
      uniqueVisitors: Number(row.uniq?.uniques || 0)
    })),
    countries: (zone.countryTraffic || []).map(row => ({
      country: row.dimensions.clientCountryName || "Bilinmiyor",
      requests: Number(row.sum?.requests || 0),
      uniqueVisitors: Number(row.uniq?.uniques || 0)
    })).sort((a, b) => b.requests - a.requests).slice(0, 15)
  };
}

export async function onRequestGet(context) {
  const auth = await requireSuperAdmin(context);
  if (auth.response) return auth.response;
  try {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    const iso = date => date.toISOString().slice(0, 10);
    const startDate = iso(start), endDate = iso(end);
    const [googleResult, cloudflareResult] = await Promise.allSettled([
      getGoogleAnalytics(context.env, startDate, endDate),
      getCloudflare(context.env, startDate, endDate)
    ]);
    const google = googleResult.status === "fulfilled"
      ? googleResult.value
      : { configured: true, error: googleResult.reason?.message || "Google Analytics bağlantı hatası." };
    const cloudflare = cloudflareResult.status === "fulfilled"
      ? cloudflareResult.value
      : { configured: true, error: cloudflareResult.reason?.message || "Cloudflare bağlantı hatası." };
    return json({ success: true, period: { startDate, endDate }, google, cloudflare });
  } catch (error) {
    return json({ success: false, message: error.message || "Analiz verileri alınamadı." }, 500);
  }
}
