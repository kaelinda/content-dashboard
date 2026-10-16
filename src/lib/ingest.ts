import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { load } from "cheerio";
import { HubError, isPublicIPv4, validateFetchUrl } from "./domain.ts";
import { saveAsset, saveSource } from "./repository.ts";
export async function safeFetch(
  input: string,
  maxBytes = 3 * 1024 * 1024,
  hops = 0,
  deadline = Date.now() + 25000,
): Promise<{ bytes: Buffer; mime: string; url: string }> {
  if (Date.now() >= deadline)
    throw new HubError("来源抓取总时限已到，请改用文件导入");
  if (hops > 3) throw new HubError("重定向次数过多");
  const url = validateFetchUrl(input);
  let addresses: { address: string; family: number }[];
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = isIP(url.hostname)
      ? [{ address: url.hostname, family: isIP(url.hostname) }]
      : await Promise.race([
          lookup(url.hostname, { all: true, family: 4 }),
          new Promise<never>((_resolve, reject) => {
            dnsTimer = setTimeout(
              () => reject(new Error("DNS timeout")),
              Math.min(5000, Math.max(1, deadline - Date.now())),
            );
          }),
        ]);
  } catch {
    throw new HubError("无法及时解析来源域名");
  } finally {
    if (dnsTimer) clearTimeout(dnsTimer);
  }
  if (!addresses.length || addresses.some((a) => !isPublicIPv4(a.address)))
    throw new HubError("拒绝访问内网、保留地址或不支持的 IPv6 来源");
  // Pin the validated DNS answer to the connection. Revalidate each redirect separately.
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "GET",
        family: 4,
        lookup: (_host, _options, callback) =>
          callback(null, addresses[0].address, 4),
        headers: {
          "User-Agent": "ContentHub/1.0 (+private knowledge archive)",
          "Accept-Encoding": "identity",
          Accept: "text/html,text/plain,image/*;q=0.8",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          try {
            resolve(
              safeFetch(
                new URL(res.headers.location, url).href,
                maxBytes,
                hops + 1,
                deadline,
              ),
            );
          } catch (e) {
            reject(e);
          }
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new HubError(`来源返回 HTTP ${status}，可改用文件或文本导入`));
          return;
        }
        const encoding = res.headers["content-encoding"];
        if (encoding && encoding !== "identity") {
          res.resume();
          reject(new HubError("来源忽略了压缩限制，请改用文件导入"));
          return;
        }
        if (Number(res.headers["content-length"] || 0) > maxBytes) {
          res.destroy();
          reject(new HubError("来源文件超过抓取大小限制", 413));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new HubError("来源文件超过抓取大小限制", 413));
          } else chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            bytes: Buffer.concat(chunks),
            mime: (res.headers["content-type"] || "application/octet-stream")
              .split(";")[0]
              .trim(),
            url: url.href,
          }),
        );
        res.on("error", () => reject(new HubError("读取来源中断")));
      },
    );
    const timer = setTimeout(
      () => {
        req.destroy();
        reject(new HubError("来源抓取超时，请改用文件导入"));
      },
      Math.min(12000, Math.max(1, deadline - Date.now())),
    );
    req.on("close", () => clearTimeout(timer));
    req.on("error", () => {
      clearTimeout(timer);
      reject(new HubError("无法建立安全连接，请检查链接或改用文件导入"));
    });
    req.end();
  });
}
export function extractHtml(html: string, base = "https://example.invalid/") {
  const $ = load(html);
  const title = (
    $("title").first().text() ||
    $("h1").first().text() ||
    "导入的网页"
  )
    .trim()
    .slice(0, 200);
  $("script,style,noscript,nav,footer,header,form,button,iframe,svg").remove();
  const root = $("article").first().length
    ? $("article").first()
    : $("main").first().length
      ? $("main").first()
      : $("body");
  const paragraphs: string[] = [];
  root.find("h1,h2,h3,p,pre,blockquote,li").each((_i, el) => {
    if ($(el).parents("pre,blockquote,li").length) return;
    const tag = el.tagName;
    const value = $(el).text().trim();
    if (!value) return;
    paragraphs.push(
      /^h[1-3]$/.test(tag)
        ? "#".repeat(Number(tag[1])) + " " + value
        : tag === "pre"
          ? "```\n" + value + "\n```"
          : tag === "blockquote"
            ? "> " + value
            : tag === "li"
              ? "- " + value
              : value,
    );
  });
  const images: { url: string; alt: string }[] = [];
  root.find("img").each((_i, el) => {
    try {
      const src = $(el).attr("src");
      if (src) {
        const url = new URL(src, base);
        if (url.protocol === "https:")
          images.push({
            url: url.href,
            alt: ($(el).attr("alt") || "来源图片").slice(0, 200),
          });
      }
    } catch {}
  });
  return {
    title,
    markdown: (paragraphs.join("\n\n") || root.text().trim()).slice(0, 500000),
    images: images.slice(0, 5),
  };
}
export async function ingestUrl(
  url: string,
  includeImages: boolean,
  actor: string,
) {
  const deadline = Date.now() + 75000;
  const result = await safeFetch(url, 3 * 1024 * 1024, 0, deadline);
  if (!["text/html", "text/plain", "text/markdown"].includes(result.mime))
    throw new HubError("此链接不是 HTML 或文本，请下载后导入原始文件");
  const extracted =
    result.mime === "text/html"
      ? extractHtml(result.bytes.toString("utf8"), result.url)
      : {
          title: new URL(result.url).hostname,
          markdown: result.bytes.toString("utf8"),
          images: [],
        };
  const savedImages: { asset_id: string; origin_url: string; alt: string }[] =
    [];
  const warnings: string[] = [];
  if (includeImages)
    for (const image of extracted.images) {
      try {
        const response = await safeFetch(
          image.url,
          6 * 1024 * 1024,
          0,
          deadline,
        );
        const asset = await saveAsset(response.bytes, image.alt, actor);
        savedImages.push({
          asset_id: asset.id,
          origin_url: image.url,
          alt: image.alt,
        });
        extracted.markdown += `\n\n![${image.alt}](asset://${asset.id})`;
      } catch {
        warnings.push(`图片未存档：${image.alt}`);
      }
    }
  return saveSource(
    result.bytes,
    {
      title: extracted.title,
      url: result.url,
      markdown: extracted.markdown,
      mime: result.mime,
      images: savedImages,
      meta: {
        requested_url: url,
        extractor: "content-hub/1",
        warnings,
        image_capture: includeImages ? "up-to-5" : "disabled",
        encoding: "utf-8",
      },
    },
    actor,
  );
}
