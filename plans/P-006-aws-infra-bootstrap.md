# P-006 AWS infra bootstrap plan

## Goal
AWS launch 基盤の bootstrap を repo 上で成立させ、`web` / `worker` / `migrate` の task definition、Secrets Manager wiring、ALB health check、deploy skeleton を実装者判断なしで扱える状態にする。

## Read first
- `tickets/platform/P-006-aws-infra-bootstrap.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0006-aws-as-launch-infrastructure.md`
- `adr/0007-db-queue-artifact-and-provenance-crypto-truth.md`
- `.agents/skills/adr-discipline/SKILL.md`

## Constraints
- `shopify.app.toml`、scope、billing truth、webhook truth は変更しない。
- full IaC、Route 53 cutover、EventBridge 実 wiring、本格 S3 adapter 実装はこの ticket の対象外。
- ECS cluster と `web` / `worker` service は事前作成済み前提にする。
- secret は `Secrets Manager -> ECS task definition secrets.valueFrom` を正本にする。

## Steps
1. `infra/aws/` に required resources と wiring をまとめた README と `web` / `worker` / `migrate` の ECS task definition template を追加する。
2. `scripts/render-aws-task-definition.mjs` を追加し、fixture input から template を render できるようにする。
3. Dockerfile、worker bootstrap entrypoint、`/health` route を追加して deploy skeleton が成立する最小 runtime contract を作る。
4. `.github/workflows/deploy.yml` に build、push、render、migrate one-off task、`web` / `worker` deploy の skeleton を追加する。
5. contract test を追加して template、workflow、health route、worker secret validation を固定する。
6. `pnpm check` が通るまで修正する。

## ADR impact
- ADR required: yes
- ADR: 0006
- Why: infra bootstrap に migration one-off task と `/health` health check を含め、AWS deploy contract を明文化するため。

## Validation
- `pnpm run test:contracts`
- `pnpm check`
- render script の fixture dry run

## Risks / open questions
- review comment: migration は GitHub runner 直実行にせず、Secrets Manager と同じ trust boundary を使う ECS one-off task に固定する。
- review comment: ALB health check は `/health` の liveness のみを扱い、DB readiness までは含めない。
- review comment: `worker` / `migrate` では `portMappings` を必須にしない。`web` のみ ALB 配下の HTTP container として扱う。
