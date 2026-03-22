/**
 * @param {Response} response
 */
export async function extractProductExportDownloadError(response) {
  const contentType = String(response.headers.get("Content-Type") ?? "").trim().toLowerCase();
  const invalidSessionRetry = String(
    response.headers.get("X-Shopify-Retry-Invalid-Session-Request") ?? "",
  ).trim();

  if (response.status === 401 && invalidSessionRetry === "1") {
    return "認証文脈が失われたため、Shopify 管理画面からアプリを開き直して再試行してください。";
  }

  if (contentType.startsWith("application/json")) {
    try {
      const payload = await response.json();

      if (payload && typeof payload === "object" && "error" in payload) {
        return String(payload.error ?? "原本ファイルのダウンロードに失敗しました。");
      }
    } catch {
      return "原本ファイルのダウンロードに失敗しました。";
    }
  }

  if (contentType.startsWith("text/html")) {
    return "認証文脈が失われたため、Shopify 管理画面からアプリを開き直して再試行してください。";
  }

  return "原本ファイルのダウンロードに失敗しました。";
}

/**
 * @param {{
 *   createAnchor?: () => { href: string; rel: string; target: string; click: () => void };
 *   openWindow?: () => { close?: () => void; location?: { href?: string; assign?: (url: string) => void }; opener?: unknown } | null;
 *   url?: string | null;
 * }} args
 */
export function startProductExportDocumentDownload({
  createAnchor = () => globalThis.document.createElement("a"),
  openWindow = () => globalThis.window?.open?.("", "_blank"),
  url,
}) {
  const openedWindow = openWindow();

  if (openedWindow) {
    try {
      openedWindow.opener = null;
    } catch {
      // Ignore cross-origin or readonly opener assignments.
    }
  }

  const navigate = (nextUrl) => {
    if (!nextUrl) {
      return;
    }

    if (openedWindow?.location && typeof openedWindow.location.assign === "function") {
      openedWindow.location.assign(nextUrl);
      return;
    }

    if (openedWindow?.location) {
      openedWindow.location.href = nextUrl;
      return;
    }

    const anchor = createAnchor();
    anchor.href = nextUrl;
    anchor.rel = "noopener noreferrer";
    anchor.target = "_blank";
    anchor.click();
  };

  const close = () => {
    if (typeof openedWindow?.close === "function") {
      openedWindow.close();
    }
  };

  if (url) {
    navigate(url);
  }

  return {
    close,
    navigate,
  };
}
