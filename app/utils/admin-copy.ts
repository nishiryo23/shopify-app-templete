const PROFILE_LABELS = {
  "product-core-seo-v1": "商品基本情報・SEO",
  "product-variants-v1": "バリエーション",
  "product-variants-prices-v1": "価格・比較価格",
  "product-inventory-v1": "在庫",
  "product-media-v1": "メディア",
  "product-metafields-v1": "メタフィールド",
  "product-manual-collections-v1": "手動コレクション",
} as const;

const ENTITLEMENT_STATE_LABELS = {
  ACTIVE_PAID: "有効",
  PAYMENT_HOLD: "支払い保留",
  PENDING_APPROVAL: "承認待ち",
  UNKNOWN: "未契約",
} as const;

const JOB_STATE_LABELS = {
  completed: "完了",
  dead_letter: "失敗",
  idle: "未開始",
  leased: "処理中",
  queued: "待機中",
  retryable: "再試行待ち",
} as const;

const OUTCOME_LABELS = {
  partial_failure: "一部失敗",
  revalidation_failed: "再検証失敗",
  rollback_failed: "ロールバック失敗",
  verified_success: "検証成功",
} as const;

const CLASSIFICATION_LABELS = {
  changed: "変更あり",
  error: "エラー",
  unchanged: "変更なし",
  warning: "要確認",
} as const;

const PROFILE_FIELD_LABELS = {
  available: "在庫数",
  barcode: "バーコード",
  body_html: "商品説明",
  collection_handle: "コレクションハンドル",
  collection_id: "コレクションID",
  collection_title: "コレクション名",
  command: "操作",
  compare_at_price: "比較価格",
  handle: "ハンドル",
  image_alt: "画像ALT",
  image_position: "画像表示順",
  image_src: "画像URL",
  inventory_policy: "在庫ポリシー",
  key: "キー",
  location_id: "ロケーションID",
  location_name: "ロケーション名",
  media_content_type: "メディア種別",
  media_id: "メディアID",
  membership: "所属状態",
  namespace: "名前空間",
  option1_name: "オプション1名",
  option1_value: "オプション1値",
  option2_name: "オプション2名",
  option2_value: "オプション2値",
  option3_name: "オプション3名",
  option3_value: "オプション3値",
  price: "価格",
  product_handle: "商品ハンドル",
  product_id: "商品ID",
  product_type: "商品タイプ",
  requires_shipping: "配送必須",
  seo_description: "SEO説明",
  seo_title: "SEOタイトル",
  sku: "SKU",
  status: "公開状態",
  tags: "タグ",
  taxable: "課税対象",
  title: "商品名",
  type: "型",
  updated_at: "更新日時",
  value: "値",
  variant_id: "バリエーションID",
  vendor: "ベンダー",
} as const;

type IncludeCodeOptions = {
  includeCode?: boolean;
};

type ProductProfile = keyof typeof PROFILE_LABELS;
type EntitlementState = keyof typeof ENTITLEMENT_STATE_LABELS;
type JobState = keyof typeof JOB_STATE_LABELS;
type Outcome = keyof typeof OUTCOME_LABELS;
type Classification = keyof typeof CLASSIFICATION_LABELS;
type ProfileField = keyof typeof PROFILE_FIELD_LABELS;

export const PRODUCT_PROFILE_OPTIONS = Object.freeze(
  Object.entries(PROFILE_LABELS).map(([value, label]) => ({ label, value })),
);

function formatCodeLabel(label: string, code: string, includeCode = true) {
  if (!includeCode || !code) {
    return label;
  }

  return `${label} (${code})`;
}

export function getProductProfileLabel(
  profile: string,
  { includeCode = true }: IncludeCodeOptions = {},
) {
  return formatCodeLabel(
    PROFILE_LABELS[profile as ProductProfile] ?? profile,
    profile,
    includeCode,
  );
}

export function getEntitlementStateLabel(
  state: string,
  { includeCode = true }: IncludeCodeOptions = {},
) {
  return formatCodeLabel(
    ENTITLEMENT_STATE_LABELS[state as EntitlementState] ?? "未契約",
    state,
    includeCode,
  );
}

export function getJobStateLabel(
  state: string,
  { includeCode = true }: IncludeCodeOptions = {},
) {
  return formatCodeLabel(JOB_STATE_LABELS[state as JobState] ?? "不明", state, includeCode);
}

export function getOutcomeLabel(
  outcome: string,
  { includeCode = true }: IncludeCodeOptions = {},
) {
  return formatCodeLabel(
    OUTCOME_LABELS[outcome as Outcome] ?? "不明",
    outcome,
    includeCode,
  );
}

export function getClassificationLabel(
  classification: string,
  { includeCode = true }: IncludeCodeOptions = {},
) {
  return formatCodeLabel(
    CLASSIFICATION_LABELS[classification as Classification] ?? "不明",
    classification,
    includeCode,
  );
}

export function getFieldLabel(field: string) {
  return PROFILE_FIELD_LABELS[field as ProfileField] ?? field;
}

export function getFormatLabel(format: string | null | undefined) {
  return String(format ?? "").toUpperCase();
}

export function getEditedLayoutLabel(
  layout: string | null | undefined,
  { includeCode = true }: IncludeCodeOptions = {},
) {
  if (layout === "matrixify") {
    return formatCodeLabel("Matrixify 互換", layout, includeCode);
  }

  return formatCodeLabel("標準レイアウト", layout || "canonical", includeCode);
}
