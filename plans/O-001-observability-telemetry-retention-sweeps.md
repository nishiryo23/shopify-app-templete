# O-001 Observability, telemetry, retention sweeps plan

## Goal
launch 前に、structured logs / metrics / alerts / retention sweep を repo truth として固定し、shop-identifiable telemetry を 7 日超で残さない運用 contract を追加する。

## Read first
- `tickets/operability/O-001-observability-telemetry-retention-sweeps.md`
- `docs/shopify_app_technical_spec_complete.md`
- `docs/shopify_app_requirements_definition_complete.md`
- `adr/0006-aws-as-launch-infrastructure.md`
- `adr/0007-db-queue-artifact-and-provenance-crypto-truth.md`
- `.agents/skills/app-review-readiness/SKILL.md`
- `workers/bootstrap.mjs`
- `domain/artifacts/prisma-artifact-catalog.mjs`
- `.github/workflows/deploy.yml`
- `tests/contracts/aws-infra-bootstrap.contract.test.mjs`
- `tests/contracts/artifact-storage.contract.test.mjs`

## Constraints
- feature scope、`shopify.app.toml`、scope、billing truth、webhook policy、privacy/delete contract は変更しない。
- telemetry は Shopify review と redact/uninstall contract に整合させ、merchant-facing payload や artifact truth を別 source-of-truth にしない。
- `Artifact.retentionUntil` を正本にしつつ、artifact payload と telemetry payload の retention policy を混同しない。
- 既存 install が追加設定なしで fail-open しないよう、必須 env は worker/web deploy で fail-fast し、alert 宛先が未設定でも core job path は壊さない。
- shop-identifiable data は 7 日超保持しない。長期保持が必要な指標は pseudonymous 集計に落とし、raw identifiers を残さない。

## Steps
1. docs / ADR / 現行コードから observability truth を棚卸しし、log event taxonomy、metrics、alert severity、retention boundary を ADR に固定する。
2. `console` 直書きを置き換える共通 telemetry モジュールを追加し、jobId / workerId / shop pseudonym / artifact kind などの structured fields と redact ルールを定義する。
3. worker / web の主要経路に telemetry を埋め込み、enqueue、lease lost、verify failure、undo cleanup failure、webhook/redact/uninstall sweep を event/metric 化する。
4. retention sweep 用の worker job と storage/catalog cleanup を追加し、`Artifact.retentionUntil`、job terminal age、telemetry pseudonymization window をまとめて処理する。
5. AWS deploy truth に alarm/scheduler wiring を追加し、stuck job、preview/write failure burst、retention sweep failure を synthetic test 可能な contract にする。
6. docs、ADR、contract/smoke を更新し、reviewer 向けに「どの識別子を何日保持するか」「どの alert で運用検知するか」を明文化する。

## ADR impact
- ADR required: yes
- ADR: 0006, 0007, 0018
- Why: observability/retention は infra と artifact/job truth の境界に直接触れ、scheduler・alert・telemetry retention contract と webhook raw payload retention boundary を repo 正本として固定する必要がある。

## Validation
- `pnpm run test:contracts`
- `pnpm check`
- synthetic alert tests
- retention sweep smoke
- deploy contract tests for required observability env / scheduler wiring

## Risks / open questions
- telemetry store を CloudWatch Logs/Metrics に閉じるか、Sentry/OpenTelemetry exporter を optional 併用にするかを先に固定する必要がある。
- shop-identifiable telemetry の定義が曖昧だと retention sweep が過不足になるため、`shopDomain`、Shopify gid、artifact metadata 内識別子の扱いを ADR で列挙する。
- alert delivery channel（SNS / email / PagerDuty 相当）が repo で未定義なら、まず「alarm 定義と fail-fast env」までを ticket 内、通知先 provisioning は out-of-scope として切る。
